// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

//! Cardano: ed25519 witnesses over Blake2b-256(tx_body_cbor).

use blake2::{Blake2b, Digest};
use blake2::digest::consts::U32;
use ed25519_dalek::Signer as _;

use crate::{derive::derive_priv_bytes, Curve, SignerError};

#[derive(Debug, Clone)]
pub struct AdaSignRequest {
    pub tx_body_cbor_hex: String,
    pub witness_paths: Vec<String>, // e.g. ["m/1852'/1815'/0'/0/0"]
}

#[derive(Debug, Clone)]
pub struct AdaWitness {
    pub public_key_hex: String,
    pub signature_hex: String,
}

#[derive(Debug, Clone)]
pub struct AdaSigned {
    pub witnesses: Vec<AdaWitness>,
    pub tx_body_hash_hex: String,
}

pub fn sign(seed: &[u8], entropy: Option<&[u8]>, req: AdaSignRequest) -> Result<AdaSigned, SignerError> {
    if req.witness_paths.is_empty() || req.witness_paths.len() > 32 {
        return Err(SignerError::InvalidRequest("ada witnesses".into()));
    }
    let body = hex::decode(req.tx_body_cbor_hex.trim_start_matches("0x"))
        .map_err(|_| SignerError::InvalidRequest("tx_body cbor hex".into()))?;
    if body.is_empty() || body.len() > 64 * 1024 {
        return Err(SignerError::InvalidRequest("tx_body size".into()));
    }
    // Hash = Blake2b-256(tx_body_cbor)
    let mut h: Blake2b<U32> = Blake2b::new();
    h.update(&body);
    let digest = h.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&digest);

    let mut witnesses = Vec::with_capacity(req.witness_paths.len());
    for path in &req.witness_paths {
        // v2 sessions: genuine CIP-1852 extended-key signatures.
        if let Some(ent) = entropy {
            let (pk, sig) = crate::derive::ada_sign_full(ent, path, &hash)?;
            witnesses.push(AdaWitness {
                public_key_hex: hex::encode(pk),
                signature_hex: hex::encode(sig),
            });
            continue;
        }
        // Legacy v1 mapping (seed only): hardened-only SLIP-10.
        let priv_bytes = derive_priv_bytes(seed, path, Curve::Ed25519)?;
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&priv_bytes.as_slice()[..32]);
        let sk = ed25519_dalek::SigningKey::from_bytes(&arr);
        let sig = sk.sign(&hash);
        witnesses.push(AdaWitness {
            public_key_hex: hex::encode(sk.verifying_key().to_bytes()),
            signature_hex: hex::encode(sig.to_bytes()),
        });
    }
    Ok(AdaSigned { witnesses, tx_body_hash_hex: hex::encode(hash) })
}
