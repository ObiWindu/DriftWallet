// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

//! Vault: Argon2id -> XChaCha20-Poly1305 sealing of seed (+ entropy since v2).
//!
//! Plaintext formats (inner version byte first):
//! - v1 (legacy): raw 64-byte BIP39 seed. No entropy — ADA falls back to the
//!   hardened-only SLIP-10 mapping (see derive.rs + MIGRATION_U030.md).
//! - v2: `[0x02, entropy_len: u8, entropy.., seed(64)]`. Full CIP-1852 available.

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{aead::Aead, KeyInit, XChaCha20Poly1305, XNonce};

use crate::{Argon2Params, EncryptedVault, SignerError};

fn argon2_ctx(p: &Argon2Params) -> Result<Argon2<'_>, SignerError> {
    let params = Params::new(p.m_kib, p.t_cost, p.p_cost, Some(32)).map_err(|_| SignerError::CryptoFailure)?;
    Ok(Argon2::new(Algorithm::Argon2id, Version::V0x13, params))
}

/// Decrypted vault secrets. `entropy` is `None` for v1 vaults.
pub struct VaultSecrets {
    pub seed: Vec<u8>,
    pub entropy: Option<Vec<u8>>,
}

pub fn encrypt(
    seed: &[u8],
    entropy: Option<&[u8]>,
    password: &[u8],
    argon2p: Argon2Params,
) -> Result<EncryptedVault, SignerError> {
    if seed.len() != 64 {
        return Err(SignerError::InvalidRequest("seed must be 64 bytes".into()));
    }
    let pt: Vec<u8> = match entropy {
        Some(e) => {
            if !matches!(e.len(), 16 | 20 | 24 | 28 | 32) {
                return Err(SignerError::InvalidRequest("entropy must be 16..32 bytes".into()));
            }
            let mut v = Vec::with_capacity(2 + e.len() + 64);
            v.push(0x02);
            v.push(e.len() as u8);
            v.extend_from_slice(e);
            v.extend_from_slice(seed);
            v
        }
        None => seed.to_vec(),
    };
    let mut salt = [0u8; 32];
    let mut nonce = [0u8; 24];
    getrandom::getrandom(&mut salt).map_err(|_| SignerError::CryptoFailure)?;
    getrandom::getrandom(&mut nonce).map_err(|_| SignerError::CryptoFailure)?;
    let ctx = argon2_ctx(&argon2p)?;
    let mut key = [0u8; 32];
    ctx.hash_password_into(password, &salt, &mut key)
        .map_err(|_| SignerError::CryptoFailure)?;
    let cipher = XChaCha20Poly1305::new_from_slice(&key).map_err(|_| SignerError::CryptoFailure)?;
    let ct = cipher
        .encrypt(XNonce::from_slice(&nonce), pt.as_slice())
        .map_err(|_| SignerError::CryptoFailure)?;
    // best-effort wipe of derived key on stack
    use zeroize::Zeroize;
    let mut k = key;
    k.zeroize();
    Ok(EncryptedVault { version: 1, salt, nonce, ciphertext: ct, argon2: argon2p })
}

pub fn decrypt(vault: &EncryptedVault, password: &[u8]) -> Result<VaultSecrets, SignerError> {
    if vault.version != 1 {
        return Err(SignerError::InvalidVault);
    }
    let ctx = argon2_ctx(&vault.argon2)?;
    let mut key = [0u8; 32];
    ctx.hash_password_into(password, &vault.salt, &mut key)
        .map_err(|_| SignerError::CryptoFailure)?;
    let cipher = XChaCha20Poly1305::new_from_slice(&key).map_err(|_| SignerError::CryptoFailure)?;
    let pt = cipher
        .decrypt(XNonce::from_slice(&vault.nonce), vault.ciphertext.as_slice())
        .map_err(|_| SignerError::WrongPassword)?;
    use zeroize::Zeroize;
    let mut k = key;
    k.zeroize();
    if pt.len() == 64 {
        return Ok(VaultSecrets { seed: pt, entropy: None });
    }
    if pt.len() >= 2 + 16 + 64 && pt[0] == 0x02 {
        let elen = pt[1] as usize;
        if matches!(elen, 16 | 20 | 24 | 28 | 32) && pt.len() == 2 + elen + 64 {
            let entropy = pt[2..2 + elen].to_vec();
            let seed = pt[2 + elen..].to_vec();
            return Ok(VaultSecrets { seed, entropy: Some(entropy) });
        }
    }
    Err(SignerError::InvalidVault)
}
