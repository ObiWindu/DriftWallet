// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

//! BIP39 helpers. Only entry point for entropy.

use bip39::Mnemonic;
use zeroize::Zeroizing;

use crate::SignerError;

pub fn generate(strength_bits: u16) -> Result<String, SignerError> {
    let entropy_len = match strength_bits {
        128 => 16,
        256 => 32,
        _ => return Err(SignerError::InvalidStrength),
    };
    let mut entropy = vec![0u8; entropy_len];
    getrandom::getrandom(&mut entropy).map_err(|_| SignerError::CryptoFailure)?;
    let m = Mnemonic::from_entropy(&entropy).map_err(|_| SignerError::CryptoFailure)?;
    Ok(m.to_string())
}

pub fn validate(phrase: &str) -> bool {
    Mnemonic::parse_normalized(phrase).is_ok()
}

/// BIP39 seed: PBKDF2-HMAC-SHA512, 2048 rounds, salt "mnemonic"+passphrase (empty here).
pub fn seed_from_phrase(phrase: &str) -> Result<Vec<u8>, SignerError> {
    let m = Mnemonic::parse_normalized(phrase.trim()).map_err(|_| SignerError::InvalidMnemonic)?;
    let seed = m.to_seed("");
    Ok(seed.to_vec())
}

/// Raw BIP39 entropy bytes (16 or 32). Needed for the CIP-1852 ed25519-bip32
/// root, which is derived from entropy (not from the seed).
pub fn entropy_from_phrase(phrase: &str) -> Result<Vec<u8>, SignerError> {
    let m = Mnemonic::parse_normalized(phrase.trim()).map_err(|_| SignerError::InvalidMnemonic)?;
    Ok(m.to_entropy())
}

#[allow(dead_code)]
pub fn zeroizing_seed(seed: Vec<u8>) -> Zeroizing<Vec<u8>> {
    Zeroizing::new(seed)
}
