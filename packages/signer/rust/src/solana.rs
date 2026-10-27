// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

//! Solana: ed25519 sign of raw message bytes.

use ed25519_dalek::Signer as _;

use crate::{derive::derive_priv_bytes, Curve, SignerError};

#[derive(Debug, Clone)]
pub struct SolanaSignRequest {
    pub message_bytes: Vec<u8>,
    pub path: String, // e.g. m/44'/501'/0'/0'
}

#[derive(Debug, Clone)]
pub struct SolanaSigned {
    pub signature_base58: String,
    pub public_key_base58: String,
}

pub fn sign(seed: &[u8], req: SolanaSignRequest) -> Result<SolanaSigned, SignerError> {
    if req.message_bytes.is_empty() || req.message_bytes.len() > 1232 {
        return Err(SignerError::InvalidRequest("solana message length".into()));
    }
    let priv_bytes = derive_priv_bytes(seed, &req.path, Curve::Ed25519)?;
    let mut arr = [0u8; 32];
    if priv_bytes.len() != 32 {
        return Err(SignerError::CryptoFailure);
    }
    arr.copy_from_slice(&priv_bytes.as_slice()[..32]);
    let sk = ed25519_dalek::SigningKey::from_bytes(&arr);
    let sig = sk.sign(&req.message_bytes);
    let pk = sk.verifying_key().to_bytes();
    Ok(SolanaSigned {
        signature_base58: bs58::encode(sig.to_bytes()).into_string(),
        public_key_base58: bs58::encode(pk).into_string(),
    })
}
