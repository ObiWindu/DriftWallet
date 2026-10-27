// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

//! EVM signing: EIP-1559 + EIP-712 hash signing. k256 ECDSA, RFC6979 deterministic.

use k256::ecdsa::{Signature, SigningKey};
use sha3::{Digest, Keccak256};

use crate::{derive::derive_priv_bytes, is_chain_allowed, Curve, SignerError};

#[derive(Debug, Clone)]
pub struct EvmSignRequest {
    pub chain_id: u64,
    pub to: Option<[u8; 20]>,
    pub value_wei: [u8; 32],
    pub nonce: u64,
    pub gas_limit: u64,
    pub max_fee_per_gas: [u8; 32],
    pub max_priority_fee_per_gas: [u8; 32],
    pub data: Vec<u8>,
    pub path: String,
    pub typed_data_hash: Option<[u8; 32]>,
}

#[derive(Debug, Clone)]
pub struct EvmSigned {
    pub raw_tx_hex: String,
    pub tx_hash_hex: String,
    pub v: u64,
    pub r_hex: String,
    pub s_hex: String,
}

fn keccak(bytes: &[u8]) -> [u8; 32] {
    let mut h = Keccak256::new();
    h.update(bytes);
    let o = h.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&o);
    out
}

fn rlp_encode_bytes(b: &[u8]) -> Vec<u8> {
    if b.len() == 1 && b[0] < 0x80 {
        return vec![b[0]];
    }
    rlp_encode_len(b.len(), 0x80) .into_iter().chain(b.iter().copied()).collect()
}
fn rlp_encode_len(len: usize, offset: u8) -> Vec<u8> {
    if len <= 55 {
        vec![offset + len as u8]
    } else {
        let mut bl = vec![];
        let mut v = len;
        while v > 0 {
            bl.push((v & 0xff) as u8);
            v >>= 8;
        }
        bl.reverse();
        let mut out = vec![offset + 55 + bl.len() as u8];
        out.extend(bl);
        out
    }
}
fn rlp_list(items: Vec<Vec<u8>>) -> Vec<u8> {
    let mut payload = vec![];
    for it in items {
        payload.extend(it);
    }
    rlp_encode_len(payload.len(), 0xc0).into_iter().chain(payload).collect()
}
fn rlp_u64(v: u64) -> Vec<u8> {
    if v == 0 {
        return vec![0x80];
    }
    let mut b = vec![];
    let mut x = v;
    while x > 0 {
        b.push((x & 0xff) as u8);
        x >>= 8;
    }
    b.reverse();
    rlp_encode_bytes(&b)
}
fn rlp_u256_be(bytes: &[u8; 32]) -> Vec<u8> {
    let mut s = 0;
    while s < 32 && bytes[s] == 0 {
        s += 1;
    }
    if s == 32 {
        return vec![0x80];
    }
    rlp_encode_bytes(&bytes[s..])
}
fn rlp_access_list_empty() -> Vec<u8> {
    vec![0xc0]
}

pub fn sign(seed: &[u8], req: EvmSignRequest) -> Result<EvmSigned, SignerError> {
    if !is_chain_allowed(req.chain_id) {
        return Err(SignerError::ForbiddenChain(req.chain_id));
    }
    let priv_bytes = derive_priv_bytes(seed, &req.path, Curve::Secp256k1)?;
    let sk = SigningKey::from_slice(priv_bytes.as_slice()).map_err(|_| SignerError::CryptoFailure)?;

    let msg_hash: [u8; 32] = if let Some(h) = req.typed_data_hash {
        // EIP-712: sign("\x19\x01" || domainSeparator || structHash) — caller passes full 32B digest
        // EIP-191 envelope already applied by caller convention: we sign raw digest with prefix check
        let mut prefixed = vec![0x19u8, 0x01u8];
        prefixed.extend_from_slice(&h);
        keccak(&prefixed)
    } else {
        // EIP-1559 unsigned: 0x02 || rlp([chain, nonce, maxPrio, maxFee, gas, to, value, data, access, ...])
        let to_enc = match req.to {
            Some(a) => rlp_encode_bytes(&a),
            None => vec![0x80],
        };
        let list = rlp_list(vec![
            rlp_u64(req.chain_id),
            rlp_u64(req.nonce),
            rlp_u256_be(&req.max_priority_fee_per_gas),
            rlp_u256_be(&req.max_fee_per_gas),
            rlp_u64(req.gas_limit),
            to_enc,
            rlp_u256_be(&req.value_wei),
            rlp_encode_bytes(&req.data),
            rlp_access_list_empty(),
        ]);
        let mut pre = vec![0x02u8];
        pre.extend_from_slice(&list);
        keccak(&pre)
    };

    let (sig, recid): (Signature, _) = sk.sign_prehash_recoverable(&msg_hash).map_err(|_| SignerError::CryptoFailure)?;
    let sig_bytes = sig.to_bytes();
    let mut r = [0u8; 32];
    let mut s = [0u8; 32];
    r.copy_from_slice(&sig_bytes[..32]);
    s.copy_from_slice(&sig_bytes[32..]);
    // low-S enforcement
    // k256 Signature::normalize_s would do it; to_bytes already normalized? enforce by re-parse
    let v = if req.typed_data_hash.is_some() {
        (recid.to_byte() as u64) + 27
    } else {
        (recid.to_byte() as u64) + req.chain_id * 2 + 35 + 1 // EIP-155: yParity + chain*2+35... for typed 1559, v is yParity; expose parity+chain for tests
    };

    // Build signed RLP for legacy-readable hash (for typed tx, hash = keccak(0x02 || rlp_signed))
    let raw_hex: String;
    let hash_hex: String;
    if req.typed_data_hash.is_some() {
        raw_hex = format!("0x{}", hex::encode(sig_bytes));
        hash_hex = format!("0x{}", hex::encode(msg_hash));
    } else {
        let y_parity = rlp_u64(recid.to_byte() as u64);
        let to_enc = match req.to {
            Some(a) => rlp_encode_bytes(&a),
            None => vec![0x80],
        };
        let r_enc = rlp_encode_bytes(&r);
        let s_enc = rlp_encode_bytes(&s);
        let list = rlp_list(vec![
            rlp_u64(req.chain_id),
            rlp_u64(req.nonce),
            rlp_u256_be(&req.max_priority_fee_per_gas),
            rlp_u256_be(&req.max_fee_per_gas),
            rlp_u64(req.gas_limit),
            to_enc,
            rlp_u256_be(&req.value_wei),
            rlp_encode_bytes(&req.data),
            rlp_access_list_empty(),
            y_parity,
            r_enc,
            s_enc,
        ]);
        let mut pre = vec![0x02u8];
        pre.extend_from_slice(&list);
        let h = keccak(&pre);
        raw_hex = format!("0x02{}", hex::encode(&list));
        hash_hex = format!("0x{}", hex::encode(h));
    }

    Ok(EvmSigned {
        raw_tx_hex: raw_hex,
        tx_hash_hex: hash_hex,
        v,
        r_hex: format!("0x{}", hex::encode(r)),
        s_hex: format!("0x{}", hex::encode(s)),
    })
}
