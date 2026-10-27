// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

//! DriftWallet trusted signer core.
//! ONLY this crate may handle mnemonic entropy / seeds.
//! UI layers receive opaque session handles, never plaintext.

#![deny(clippy::unwrap_used)]
#![deny(clippy::expect_used)]

pub mod bitcoin;
pub mod cardano;
pub mod derive;
pub mod evm;
pub mod ffi;
pub mod mnemonic;
pub mod solana;
pub mod vault;
pub mod wasm_bind;

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use zeroize::Zeroizing;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum SignerError {
    #[error("invalid mnemonic")]
    InvalidMnemonic,
    #[error("invalid strength: must be 128 or 256")]
    InvalidStrength,
    #[error("crypto failure")]
    CryptoFailure,
    #[error("invalid vault")]
    InvalidVault,
    #[error("wrong password")]
    WrongPassword,
    #[error("unknown or expired session")]
    BadSession,
    #[error("forbidden derivation path: {0}")]
    ForbiddenPath(String),
    #[error("forbidden chain id: {0}")]
    ForbiddenChain(u64),
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    #[error("fee policy violation: {0}")]
    FeePolicy(String),
}

static SESSIONS: OnceLock<Mutex<HashMap<u64, Session>>> = OnceLock::new();
static NEXT_ID: OnceLock<Mutex<u64>> = OnceLock::new();

fn sessions() -> &'static Mutex<HashMap<u64, Session>> {
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}
fn next_id() -> &'static Mutex<u64> {
    NEXT_ID.get_or_init(|| Mutex::new(1))
}

struct Session {
    seed: Zeroizing<Vec<u8>>, // 64-byte BIP39 seed
    entropy: Option<Zeroizing<Vec<u8>>>, // BIP39 entropy (v2 vaults) for CIP-1852
    last_used: Instant,
}

const SESSION_TTL: Duration = Duration::from_secs(5 * 60);

fn with_session<T>(handle: u64, f: impl FnOnce(&mut Session) -> Result<T, SignerError>) -> Result<T, SignerError> {
    let map = sessions();
    let mut guard = map.lock().map_err(|_| SignerError::CryptoFailure)?;
    let sess = guard.get_mut(&handle).ok_or(SignerError::BadSession)?;
    if sess.last_used.elapsed() > SESSION_TTL {
        guard.remove(&handle);
        return Err(SignerError::BadSession);
    }
    sess.last_used = Instant::now();
    f(sess)
}

pub type SessionHandle = u64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Curve {
    Secp256k1,
    Ed25519,
}

#[derive(Debug, Clone)]
pub struct Argon2Params {
    pub m_kib: u32,
    pub t_cost: u32,
    pub p_cost: u32,
}

impl Default for Argon2Params {
    fn default() -> Self {
        Self { m_kib: 65536, t_cost: 3, p_cost: 4 }
    }
}

impl Argon2Params {
    pub fn test_light() -> Self {
        Self { m_kib: 8192, t_cost: 1, p_cost: 1 }
    }
}

/// Generate a fresh BIP39 English mnemonic. CSPRNG via getrandom.
pub fn generate_mnemonic(strength_bits: u16) -> Result<String, SignerError> {
    mnemonic::generate(strength_bits)
}

pub fn validate_mnemonic(phrase: &str) -> bool {
    mnemonic::validate(phrase)
}

#[derive(Debug, Clone)]
pub struct EncryptedVault {
    pub version: u8,
    pub salt: [u8; 32],
    pub nonce: [u8; 24],
    pub ciphertext: Vec<u8>,
    pub argon2: Argon2Params,
}

/// Encrypt BIP39 seed (+ entropy for CIP-1852) derived from phrase -> vault blob.
/// New vaults always store entropy (v2 format); v1 blobs stay readable.
pub fn entropy_to_vault(
    phrase: &str,
    password: &str,
    params: Argon2Params,
) -> Result<EncryptedVault, SignerError> {
    let seed = mnemonic::seed_from_phrase(phrase)?;
    let entropy = mnemonic::entropy_from_phrase(phrase)?;
    vault::encrypt(&seed, Some(&entropy), password.as_bytes(), params)
}

/// Decrypt vault -> in-memory session handle. Caller must `lock()` when done.
pub fn unlock_vault(vault: &EncryptedVault, password: &[u8]) -> Result<SessionHandle, SignerError> {
    let secrets = vault::decrypt(vault, password)?;
    let mut id_guard = next_id().lock().map_err(|_| SignerError::CryptoFailure)?;
    let id = *id_guard;
    *id_guard = id.wrapping_add(1);
    drop(id_guard);
    let mut map = sessions().lock().map_err(|_| SignerError::CryptoFailure)?;
    map.insert(
        id,
        Session {
            seed: Zeroizing::new(secrets.seed),
            entropy: secrets.entropy.map(Zeroizing::new),
            last_used: Instant::now(),
        },
    );
    Ok(id)
}

/// Zeroize + drop session.
pub fn lock(handle: SessionHandle) -> Result<(), SignerError> {
    let mut map = sessions().lock().map_err(|_| SignerError::CryptoFailure)?;
    map.remove(&handle).ok_or(SignerError::BadSession)?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct PubkeyOutput {
    pub public_key_hex: String,
    pub address: String,
}

/// Derive pubkey + address for an allowed path.
pub fn derive_pubkey(handle: SessionHandle, path: &str, curve: Curve) -> Result<PubkeyOutput, SignerError> {
    with_session(handle, |sess| {
        derive::derive_pubkey(
            sess.seed.as_slice(),
            sess.entropy.as_ref().map(|e| e.as_slice()),
            path,
            curve,
        )
    })
}

// Re-exports for request types
pub use bitcoin::BtcSignRequest;
pub use cardano::AdaSignRequest;
pub use evm::{EvmSignRequest, EvmSigned};
pub use solana::{SolanaSignRequest, SolanaSigned};

pub fn sign_evm(handle: SessionHandle, req: EvmSignRequest) -> Result<EvmSigned, SignerError> {
    with_session(handle, |sess| evm::sign(sess.seed.as_slice(), req))
}
pub fn sign_solana(handle: SessionHandle, req: SolanaSignRequest) -> Result<SolanaSigned, SignerError> {
    with_session(handle, |sess| solana::sign(sess.seed.as_slice(), req))
}
pub fn sign_bitcoin(
    handle: SessionHandle,
    req: BtcSignRequest,
) -> Result<bitcoin::BtcSigned, SignerError> {
    with_session(handle, |sess| bitcoin::sign(sess.seed.as_slice(), req))
}
pub fn sign_cardano(handle: SessionHandle, req: AdaSignRequest) -> Result<cardano::AdaSigned, SignerError> {
    with_session(handle, |sess| {
        cardano::sign(sess.seed.as_slice(), sess.entropy.as_ref().map(|e| e.as_slice()), req)
    })
}

/// Allowed chain ids (mainnet + testnets). Testnets always allowed (gateway decides mainnet enable).
pub fn is_chain_allowed(chain_id: u64) -> bool {
    matches!(
        chain_id,
        1 | 56 | 137 | 42161 | 8453 | 11155111 | 97 | 80002 | 421614 | 84532
    )
}
