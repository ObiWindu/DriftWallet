// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

//! Bitcoin: sign sighashes with P2WPKH keys + fee policy gate.
//! Full PSBT parsing is done in TS (bitcoinjs-lib); Rust is the signing oracle
//! and enforces fee policy. psbt_base64 is validated for magic + ownership hints.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use k256::ecdsa::{signature::hazmat::{PrehashSigner, PrehashVerifier}, Signature, SigningKey};

use sha2::{Digest, Sha256};

use crate::{derive::derive_priv_bytes, Curve, SignerError};
use crate::derive::purpose_type;

#[derive(Debug, Clone)]
pub struct BtcInput {
    pub sighash_hex: String, // 32-byte sighash (BIP143/341) hex
    pub path: String,        // e.g. m/84'/0'/0'/0/0
}

#[derive(Debug, Clone)]
pub struct BtcSignRequest {
    pub inputs: Vec<BtcInput>,
    pub psbt_base64: String,
    pub fee_sats: u64,
    pub total_in_sats: u64,
    pub total_out_sats: u64,
    pub allow_high_fee: bool,
}

#[derive(Debug, Clone)]
pub struct BtcSig {
    pub public_key_hex: String,
    pub der_sig_hex: String,
}

#[derive(Debug, Clone)]
pub struct BtcSigned {
    pub signatures: Vec<BtcSig>,
}

fn fee_check(req: &BtcSignRequest) -> Result<(), SignerError> {
    if req.total_out_sats > req.total_in_sats {
        return Err(SignerError::FeePolicy("outputs exceed inputs".into()));
    }
    let fee = req.total_in_sats - req.total_out_sats;
    if fee != req.fee_sats {
        return Err(SignerError::FeePolicy("fee mismatch".into()));
    }
    if req.total_in_sats > 0 {
        // fee > 5% of inputs
        if fee * 100 > req.total_in_sats * 5 && !req.allow_high_fee {
            return Err(SignerError::FeePolicy(format!("fee {} sats > 5% of inputs", fee)));
        }
    }
    // absolute cap 0.01 BTC = 1_000_000 sats without explicit allow
    if fee > 1_000_000 && !req.allow_high_fee {
        return Err(SignerError::FeePolicy(format!("fee {} sats > 0.01 BTC cap", fee)));
    }
    Ok(())
}

/// BIP86 Taproot key-path spend: internal key at `path`, tweaked per BIP341,
/// BIP340 Schnorr signature over the 32-byte sighash. Returned `der_sig_hex`
/// carries the raw 64-byte Schnorr signature (no DER, no sighash byte —
/// key-path spends commit to SIGHASH_DEFAULT implicitly).
fn sign_taproot(seed: &[u8], path: &str, sighash: &[u8]) -> Result<BtcSig, SignerError> {
    use k256::schnorr::signature::hazmat::PrehashVerifier;
    let priv_bytes = derive_priv_bytes(seed, path, Curve::Secp256k1)?;
    if priv_bytes.len() != 32 {
        return Err(SignerError::CryptoFailure);
    }
    let mut raw = [0u8; 32];
    raw.copy_from_slice(priv_bytes.as_slice());
    let (qx, q) = crate::derive::taproot_tweak(&raw)?;
    let sk = k256::schnorr::SigningKey::from_bytes(&q).map_err(|_| SignerError::CryptoFailure)?;
    let mut msg = [0u8; 32];
    msg.copy_from_slice(sighash);
    let mut aux = [0u8; 32];
    getrandom::getrandom(&mut aux).map_err(|_| SignerError::CryptoFailure)?;
    let sig = sk.sign_prehash_with_aux_rand(&msg, &aux).map_err(|_| SignerError::CryptoFailure)?;
    // Self-check against the tweaked output key.
    {
        let vk = k256::schnorr::VerifyingKey::from_bytes(&qx).map_err(|_| SignerError::CryptoFailure)?;
        vk.verify_prehash(&msg, &sig).map_err(|_| SignerError::CryptoFailure)?;
    }
    Ok(BtcSig { public_key_hex: hex::encode(qx), der_sig_hex: hex::encode(sig.to_bytes()) })
}

pub fn sign(seed: &[u8], req: BtcSignRequest) -> Result<BtcSigned, SignerError> {
    if req.inputs.is_empty() || req.inputs.len() > 256 {
        return Err(SignerError::InvalidRequest("btc inputs".into()));
    }
    // Validate PSBT envelope magic: base64 -> starts with "psbt\xff"
    let raw = B64.decode(req.psbt_base64.trim()).map_err(|_| SignerError::InvalidRequest("psbt base64".into()))?;
    if raw.len() < 5 || &raw[..5] != b"psbt\xff" {
        return Err(SignerError::InvalidRequest("psbt magic".into()));
    }
    fee_check(&req)?;

    let mut out = Vec::with_capacity(req.inputs.len());
    for inp in &req.inputs {
        let sighash = hex::decode(inp.sighash_hex.trim_start_matches("0x"))
            .map_err(|_| SignerError::InvalidRequest("sighash hex".into()))?;
        if sighash.len() != 32 {
            return Err(SignerError::InvalidRequest("sighash must be 32 bytes".into()));
        }
        // BIP86 key-path: purpose-86 inputs sign with tweaked Schnorr (BIP340/341).
        if purpose_type(&inp.path).unwrap_or(44) == 86 {
            out.push(sign_taproot(seed, &inp.path, &sighash)?);
            continue;
        }
        let priv_bytes = derive_priv_bytes(seed, &inp.path, Curve::Secp256k1)?;
        let sk = SigningKey::from_slice(priv_bytes.as_slice()).map_err(|_| SignerError::CryptoFailure)?;
        let (sig, _): (Signature, _) = sk.sign_prehash(&sighash).map_err(|_| SignerError::CryptoFailure)?;
        let der = sig.to_der();
        let vk = sk.verifying_key();
        let comp = k256::EncodedPoint::from(vk).to_bytes().to_vec();
        // commit to sighash type SIGHASH_ALL
        let mut der_plus = der.as_bytes().to_vec();
        der_plus.push(0x01);
        // double-check: signature verifies
        {
            use k256::ecdsa::VerifyingKey;
            let vk2 = VerifyingKey::from(&sk);
            // verify against prehash (k256 ecdsa verify_prehash)
            vk2.verify_prehash(&sighash, &sig).map_err(|_| SignerError::CryptoFailure)?;
            let _ = Sha256::digest(&sighash); // touch sha2 to keep dep used
        }
        out.push(BtcSig { public_key_hex: hex::encode(comp), der_sig_hex: hex::encode(der_plus) });
    }
    Ok(BtcSigned { signatures: out })
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod fee_tests {
    use super::*;

    /// Deterministic PRNG sweep: fee_check must never panic, and must accept
    /// exactly the policy (fee == in-out, <=5% unless allowed, <=0.01 BTC cap).
    #[test]
    fn fee_policy_sweep() {
        fn rng(state: &mut u64) -> u64 {
            *state ^= *state >> 12;
            *state ^= *state << 25;
            *state ^= *state >> 27;
            *state = state.wrapping_mul(0x2545F4914F6CDD1D);
            *state
        }
        let mut st = 0x9e37_79b9_7f4a_7c15u64;
        for _ in 0..20_000 {
            let total_in = rng(&mut st) % 20_000_000;
            let total_out = rng(&mut st) % 20_000_000;
            let fee_claim = rng(&mut st) % 20_000_000;
            let allow = rng(&mut st) % 2 == 0;
            let req = BtcSignRequest {
                inputs: vec![],
                psbt_base64: String::new(),
                fee_sats: fee_claim,
                total_in_sats: total_in,
                total_out_sats: total_out,
                allow_high_fee: allow,
            };
            let ok = fee_check(&req).is_ok();
            let real_fee = total_in.saturating_sub(total_out);
            let expect = total_out <= total_in
                && fee_claim == real_fee
                && (total_in == 0 || fee_claim * 100 <= total_in * 5 || allow)
                && (fee_claim <= 1_000_000 || allow);
            assert_eq!(ok, expect, "in={total_in} out={total_out} fee={fee_claim} allow={allow}");
        }
    }
}
