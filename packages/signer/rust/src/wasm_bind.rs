// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

//! wasm-bindgen surface for the extension offscreen document.
//!
//! Same JSON-string contract as [`crate::ffi`]: every function takes a JSON
//! string and returns a JSON string (`{...}` or `{"error":"..."}`).
//! Sessions live in WASM linear memory only — never localStorage.
//! (See `packages/signer/ts/src/wasm.ts`.)
//!
//! This module compiles on all targets (wasm-bindgen is a no-op expander on
//! host), so `cargo test` / `clippy` check it. It is *used* on wasm32 only.

use wasm_bindgen::prelude::*;

use crate::{Argon2Params, Curve, EncryptedVault};

fn err(msg: impl Into<String>) -> String {
    serde_json::json!({ "error": msg.into() }).to_string()
}

fn parse(s: &str) -> Result<serde_json::Value, String> {
    serde_json::from_str(s).map_err(|_| "invalid json".to_string())
}

fn u64_field(v: &serde_json::Value, key: &str) -> Result<u64, String> {
    match v.get(key) {
        Some(serde_json::Value::Number(n)) => n.as_u64().ok_or(format!("bad {key}")),
        Some(serde_json::Value::String(s)) => s.trim().parse::<u64>().map_err(|_| format!("bad {key}")),
        _ => Err(format!("missing {key}")),
    }
}

fn str_field(v: &serde_json::Value, key: &str, what: &str) -> Result<String, String> {
    v.get(key).and_then(|x| x.as_str()).map(|s| s.to_string()).ok_or(format!("missing {what}"))
}

fn hex_trimmed(s: &str) -> &str {
    let t = s.trim();
    t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")).unwrap_or(t)
}

fn parse_hex32(s: &str, what: &str) -> Result<[u8; 32], String> {
    let b = hex::decode(hex_trimmed(s)).map_err(|_| format!("bad {what} hex"))?;
    if b.len() != 32 {
        return Err(format!("{what} must be 32 bytes"));
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&b);
    Ok(out)
}

fn parse_hex20(s: &str) -> Result<[u8; 20], String> {
    let b = hex::decode(hex_trimmed(s)).map_err(|_| "bad address hex".to_string())?;
    if b.len() != 20 {
        return Err("address must be 20 bytes".to_string());
    }
    let mut out = [0u8; 20];
    out.copy_from_slice(&b);
    Ok(out)
}

/// Decimal u256 string -> 32B big-endian (no new crates).
fn parse_u256_dec(s: &str) -> Result<[u8; 32], String> {
    let t = s.trim();
    if t.is_empty() || !t.bytes().all(|b| b.is_ascii_digit()) {
        return Err("bad u256 decimal".to_string());
    }
    let mut out = [0u8; 32];
    for byte in t.bytes() {
        let digit = (byte - b'0') as u16;
        let mut carry: u16 = digit;
        let mut i = 31usize;
        loop {
            let cur = (out[i] as u16) * 10 + carry;
            out[i] = (cur & 0xff) as u8;
            carry = cur >> 8;
            if i == 0 {
                break;
            }
            i -= 1;
        }
        if carry != 0 {
            return Err("u256 overflow".to_string());
        }
    }
    Ok(out)
}

fn vault_from_value(v: &serde_json::Value) -> Result<EncryptedVault, String> {
    let version = v.get("version").and_then(|x| x.as_u64()).ok_or("bad vault version".to_string())?;
    if version != 1 {
        return Err("invalid vault version".to_string());
    }
    let salt_hex = v.get("saltHex").and_then(|x| x.as_str()).ok_or("bad saltHex".to_string())?;
    let nonce_hex = v.get("nonceHex").and_then(|x| x.as_str()).ok_or("bad nonceHex".to_string())?;
    let ct_hex = v.get("ciphertextHex").and_then(|x| x.as_str()).ok_or("bad ciphertextHex".to_string())?;
    let salt = hex::decode(salt_hex.trim()).map_err(|_| "bad saltHex".to_string())?;
    let nonce = hex::decode(nonce_hex.trim()).map_err(|_| "bad nonceHex".to_string())?;
    let ct = hex::decode(ct_hex.trim()).map_err(|_| "bad ciphertextHex".to_string())?;
    if salt.len() != 32 || nonce.len() != 24 {
        return Err("bad vault sizes".to_string());
    }
    let argon = v.get("argon2").ok_or("bad argon2".to_string())?;
    let m_kib = argon.get("mKib").and_then(|x| x.as_u64()).ok_or("bad argon2".to_string())? as u32;
    let t_cost = argon.get("tCost").and_then(|x| x.as_u64()).ok_or("bad argon2".to_string())? as u32;
    let p_cost = argon.get("pCost").and_then(|x| x.as_u64()).ok_or("bad argon2".to_string())? as u32;
    let mut salt_arr = [0u8; 32];
    salt_arr.copy_from_slice(&salt);
    let mut nonce_arr = [0u8; 24];
    nonce_arr.copy_from_slice(&nonce);
    Ok(EncryptedVault {
        version: 1,
        salt: salt_arr,
        nonce: nonce_arr,
        ciphertext: ct,
        argon2: Argon2Params { m_kib, t_cost, p_cost },
    })
}

fn vault_to_value(v: &EncryptedVault) -> serde_json::Value {
    serde_json::json!({
        "version": v.version,
        "saltHex": hex::encode(v.salt),
        "nonceHex": hex::encode(v.nonce),
        "ciphertextHex": hex::encode(v.ciphertext.clone()),
        "argon2": { "mKib": v.argon2.m_kib, "tCost": v.argon2.t_cost, "pCost": v.argon2.p_cost }
    })
}

fn parse_curve(s: &str) -> Result<Curve, String> {
    match s {
        "Secp256k1" | "secp256k1" => Ok(Curve::Secp256k1),
        "Ed25519" | "ed25519" => Ok(Curve::Ed25519),
        _ => Err("unknown curve".to_string()),
    }
}

/// Capabilities JSON (mirrors `drift_capabilities`).
#[wasm_bindgen]
pub fn capabilities() -> String {
    serde_json::json!({
        "functions": ["generate_mnemonic","validate_mnemonic","entropy_to_vault","unlock_vault","lock",
                      "derive_pubkey","sign_evm","sign_solana","sign_bitcoin","sign_cardano"],
        "allowedChains": [1, 56, 137, 42161, 8453, 11155111, 97, 80002, 421614, 84532],
        "curves": ["Secp256k1", "Ed25519"],
        "abi": "json-string",
        "version": 1
    })
    .to_string()
}

/// `{"strengthBits":128|256}` -> `{"mnemonic":"..."}`.
#[wasm_bindgen]
pub fn generate_mnemonic(req: &str) -> String {
    let v = match parse(req) {
        Ok(v) => v,
        Err(e) => return err(e),
    };
    let strength = v.get("strengthBits").and_then(|x| x.as_u64()).unwrap_or(0) as u16;
    match crate::generate_mnemonic(strength) {
        Ok(m) => serde_json::json!({ "mnemonic": m }).to_string(),
        Err(e) => err(e.to_string()),
    }
}

/// `{"phrase":"..."}` -> `{"valid":bool}`.
#[wasm_bindgen]
pub fn validate_mnemonic(req: &str) -> String {
    let v = match parse(req) {
        Ok(v) => v,
        Err(e) => return err(e),
    };
    let phrase = v.get("phrase").and_then(|x| x.as_str()).unwrap_or("");
    serde_json::json!({ "valid": crate::validate_mnemonic(phrase) }).to_string()
}

/// `{"phrase":"...","password":"...","lightKdf":bool}` -> vault JSON.
#[wasm_bindgen]
pub fn entropy_to_vault(req: &str) -> String {
    let v = match parse(req) {
        Ok(v) => v,
        Err(e) => return err(e),
    };
    let phrase = match v.get("phrase").and_then(|x| x.as_str()) {
        Some(p) => p.to_string(),
        None => return err("missing phrase"),
    };
    let password = match v.get("password").and_then(|x| x.as_str()) {
        Some(p) => p.to_string(),
        None => return err("missing password"),
    };
    let light = v.get("lightKdf").and_then(|x| x.as_bool()).unwrap_or(false);
    let params = if light { Argon2Params::test_light() } else { Argon2Params::default() };
    match crate::entropy_to_vault(&phrase, &password, params) {
        Ok(vault) => vault_to_value(&vault).to_string(),
        Err(e) => err(e.to_string()),
    }
}

/// `{"vault":{...},"password":"..."}` -> `{"sessionId":N}`.
#[wasm_bindgen]
pub fn unlock_vault(req: &str) -> String {
    let v = match parse(req) {
        Ok(v) => v,
        Err(e) => return err(e),
    };
    let vault_v = match v.get("vault") {
        Some(x) => x.clone(),
        None => return err("missing vault"),
    };
    let vault = match vault_from_value(&vault_v) {
        Ok(x) => x,
        Err(e) => return err(e),
    };
    let password = match v.get("password").and_then(|x| x.as_str()) {
        Some(p) => p.to_string(),
        None => return err("missing password"),
    };
    match crate::unlock_vault(&vault, password.as_bytes()) {
        Ok(h) => serde_json::json!({ "sessionId": h }).to_string(),
        Err(e) => err(e.to_string()),
    }
}

/// `{"sessionId":N}` -> `{"locked":true}`.
#[wasm_bindgen]
pub fn lock_session(req: &str) -> String {
    let v = match parse(req) {
        Ok(v) => v,
        Err(e) => return err(e),
    };
    let h = match v.get("sessionId").and_then(|x| x.as_u64()) {
        Some(x) => x,
        None => return err("missing sessionId"),
    };
    match crate::lock(h) {
        Ok(()) => serde_json::json!({ "locked": true }).to_string(),
        Err(e) => err(e.to_string()),
    }
}

/// `{"sessionId":N,"path":"m/...","curve":"Secp256k1|Ed25519"}`.
#[wasm_bindgen]
pub fn derive_pubkey(req: &str) -> String {
    let v = match parse(req) {
        Ok(v) => v,
        Err(e) => return err(e),
    };
    let h = match v.get("sessionId").and_then(|x| x.as_u64()) {
        Some(x) => x,
        None => return err("missing sessionId"),
    };
    let path = match str_field(&v, "path", "path") {
        Ok(p) => p,
        Err(e) => return err(e),
    };
    let curve_s = match str_field(&v, "curve", "curve") {
        Ok(c) => c,
        Err(e) => return err(e),
    };
    let curve = match parse_curve(&curve_s) {
        Ok(c) => c,
        Err(e) => return err(e),
    };
    match crate::derive_pubkey(h, &path, curve) {
        Ok(o) => serde_json::json!({ "publicKeyHex": o.public_key_hex, "address": o.address }).to_string(),
        Err(e) => err(e.to_string()),
    }
}

/// EVM signing (same shape as `drift_sign_evm`).
#[wasm_bindgen]
pub fn sign_evm(req: &str) -> String {
    let v = match parse(req) {
        Ok(v) => v,
        Err(e) => return err(e),
    };
    let h = match v.get("sessionId").and_then(|x| x.as_u64()) {
        Some(x) => x,
        None => return err("missing sessionId"),
    };
    let chain_id = match v.get("chainId").and_then(|x| x.as_u64()) {
        Some(x) => x,
        None => return err("missing chainId"),
    };
    let to = match v.get("to") {
        Some(serde_json::Value::Null) | None => None,
        Some(serde_json::Value::String(s)) if s.is_empty() => None,
        Some(serde_json::Value::String(s)) => match parse_hex20(s) {
            Ok(a) => Some(a),
            Err(e) => return err(e),
        },
        _ => return err("bad to"),
    };
    let value_wei = match v.get("valueWei").and_then(|x| x.as_str()) {
        Some(s) => match parse_u256_dec(s) {
            Ok(x) => x,
            Err(e) => return err(e),
        },
        None => return err("missing valueWei"),
    };
    let nonce = match v.get("nonce").and_then(|x| x.as_u64()) {
        Some(x) => x,
        None => return err("missing nonce"),
    };
    let gas_limit = match u64_field(&v, "gasLimit") {
        Ok(x) => x,
        Err(e) => return err(e),
    };
    let max_fee = match v.get("maxFeePerGasWei").and_then(|x| x.as_str()) {
        Some(s) => match parse_u256_dec(s) {
            Ok(x) => x,
            Err(e) => return err(e),
        },
        None => return err("missing maxFeePerGasWei"),
    };
    let max_prio = match v.get("maxPriorityFeePerGasWei").and_then(|x| x.as_str()) {
        Some(s) => match parse_u256_dec(s) {
            Ok(x) => x,
            Err(e) => return err(e),
        },
        None => return err("missing maxPriorityFeePerGasWei"),
    };
    let data_hex = v.get("dataHex").and_then(|x| x.as_str()).unwrap_or("0x");
    let data = match hex::decode(hex_trimmed(data_hex)) {
        Ok(b) => b,
        Err(_) => return err("bad dataHex"),
    };
    let path = match str_field(&v, "path", "path") {
        Ok(p) => p,
        Err(e) => return err(e),
    };
    let typed = match v.get("typedDataHashHex") {
        Some(serde_json::Value::Null) | None => None,
        Some(serde_json::Value::String(s)) if s.is_empty() => None,
        Some(serde_json::Value::String(s)) => match parse_hex32(s, "typedDataHash") {
            Ok(x) => Some(x),
            Err(e) => return err(e),
        },
        _ => return err("bad typedDataHashHex"),
    };
    let evm_req = crate::EvmSignRequest {
        chain_id,
        to,
        value_wei,
        nonce,
        gas_limit,
        max_fee_per_gas: max_fee,
        max_priority_fee_per_gas: max_prio,
        data,
        path,
        typed_data_hash: typed,
    };
    match crate::sign_evm(h, evm_req) {
        Ok(s) => serde_json::json!({
            "rawTxHex": s.raw_tx_hex, "txHashHex": s.tx_hash_hex,
            "v": s.v, "rHex": s.r_hex, "sHex": s.s_hex
        })
        .to_string(),
        Err(e) => err(e.to_string()),
    }
}

/// `{"sessionId":N,"messageBytesHex":"...","path":"..."}`.
#[wasm_bindgen]
pub fn sign_solana(req: &str) -> String {
    let v = match parse(req) {
        Ok(v) => v,
        Err(e) => return err(e),
    };
    let h = match v.get("sessionId").and_then(|x| x.as_u64()) {
        Some(x) => x,
        None => return err("missing sessionId"),
    };
    let msg_hex = match str_field(&v, "messageBytesHex", "messageBytesHex") {
        Ok(s) => s,
        Err(e) => return err(e),
    };
    let msg = match hex::decode(hex_trimmed(&msg_hex)) {
        Ok(b) => b,
        Err(_) => return err("bad messageBytesHex"),
    };
    let path = match str_field(&v, "path", "path") {
        Ok(p) => p,
        Err(e) => return err(e),
    };
    match crate::sign_solana(h, crate::SolanaSignRequest { message_bytes: msg, path }) {
        Ok(s) => serde_json::json!({
            "signatureBase58": s.signature_base58, "publicKeyBase58": s.public_key_base58
        })
        .to_string(),
        Err(e) => err(e.to_string()),
    }
}

/// Bitcoin signing (same shape as `drift_sign_bitcoin`).
#[wasm_bindgen]
pub fn sign_bitcoin(req: &str) -> String {
    let v = match parse(req) {
        Ok(v) => v,
        Err(e) => return err(e),
    };
    let h = match v.get("sessionId").and_then(|x| x.as_u64()) {
        Some(x) => x,
        None => return err("missing sessionId"),
    };
    let inputs_v = match v.get("inputs").and_then(|x| x.as_array()) {
        Some(a) => a.clone(),
        None => return err("missing inputs"),
    };
    let mut inputs = Vec::with_capacity(inputs_v.len());
    for item in &inputs_v {
        let sighash_hex = match item.get("sighashHex").and_then(|x| x.as_str()) {
            Some(s) => s.to_string(),
            None => return err("bad input sighashHex"),
        };
        let path = match item.get("path").and_then(|x| x.as_str()) {
            Some(s) => s.to_string(),
            None => return err("bad input path"),
        };
        inputs.push(crate::bitcoin::BtcInput { sighash_hex, path });
    }
    let psbt_base64 = match str_field(&v, "psbtBase64", "psbtBase64") {
        Ok(s) => s,
        Err(e) => return err(e),
    };
    let fee_sats = match u64_field(&v, "feeSats") {
        Ok(x) => x,
        Err(e) => return err(e),
    };
    let total_in = match u64_field(&v, "totalInSats") {
        Ok(x) => x,
        Err(e) => return err(e),
    };
    let total_out = match u64_field(&v, "totalOutSats") {
        Ok(x) => x,
        Err(e) => return err(e),
    };
    let allow = v.get("allowHighFee").and_then(|x| x.as_bool()).unwrap_or(false);
    let btc_req = crate::BtcSignRequest {
        inputs,
        psbt_base64,
        fee_sats,
        total_in_sats: total_in,
        total_out_sats: total_out,
        allow_high_fee: allow,
    };
    match crate::sign_bitcoin(h, btc_req) {
        Ok(s) => {
            let sigs: Vec<serde_json::Value> = s
                .signatures
                .iter()
                .map(|sig| serde_json::json!({
                    "publicKeyHex": sig.public_key_hex, "derSigHex": sig.der_sig_hex
                }))
                .collect();
            serde_json::json!({ "signatures": sigs }).to_string()
        }
        Err(e) => err(e.to_string()),
    }
}

/// `{"sessionId":N,"txBodyCborHex":"...","witnessPaths":[...]}`.
#[wasm_bindgen]
pub fn sign_cardano(req: &str) -> String {
    let v = match parse(req) {
        Ok(v) => v,
        Err(e) => return err(e),
    };
    let h = match v.get("sessionId").and_then(|x| x.as_u64()) {
        Some(x) => x,
        None => return err("missing sessionId"),
    };
    let tx_hex = match str_field(&v, "txBodyCborHex", "txBodyCborHex") {
        Ok(s) => s,
        Err(e) => return err(e),
    };
    let paths_v = match v.get("witnessPaths").and_then(|x| x.as_array()) {
        Some(a) => a.clone(),
        None => return err("missing witnessPaths"),
    };
    let mut paths = Vec::with_capacity(paths_v.len());
    for p in &paths_v {
        match p.as_str() {
            Some(s) => paths.push(s.to_string()),
            None => return err("bad witnessPaths"),
        }
    }
    match crate::sign_cardano(h, crate::AdaSignRequest { tx_body_cbor_hex: tx_hex, witness_paths: paths }) {
        Ok(s) => {
            let w: Vec<serde_json::Value> = s
                .witnesses
                .iter()
                .map(|x| serde_json::json!({
                    "publicKeyHex": x.public_key_hex, "signatureHex": x.signature_hex
                }))
                .collect();
            serde_json::json!({ "witnesses": w, "txBodyHashHex": s.tx_body_hash_hex }).to_string()
        }
        Err(e) => err(e.to_string()),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
#[allow(clippy::expect_used)]
mod wasm_bind_tests {
    use super::*;

    #[test]
    fn capabilities_and_validate_roundtrip() {
        let caps: serde_json::Value = serde_json::from_str(&capabilities()).expect("caps json");
        let fns = caps.get("functions").and_then(|x| x.as_array()).expect("functions");
        assert!(fns.iter().any(|f| f.as_str() == Some("sign_evm")));
        let out = validate_mnemonic(r#"{"phrase":"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"}"#);
        let v: serde_json::Value = serde_json::from_str(&out).expect("validate json");
        assert_eq!(v.get("valid").and_then(|x| x.as_bool()), Some(true));
        let bad = generate_mnemonic(r#"{"strengthBits":64}"#);
        let bv: serde_json::Value = serde_json::from_str(&bad).expect("err json");
        assert!(bv.get("error").is_some());
    }

    #[test]
    fn vault_and_sign_roundtrip_light_kdf() {
        let phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        let venv = entropy_to_vault(
            &serde_json::json!({ "phrase": phrase, "password": "test-password-123", "lightKdf": true }).to_string(),
        );
        let vv: serde_json::Value = serde_json::from_str(&venv).expect("vault json");
        assert!(vv.get("ciphertextHex").is_some(), "expected vault, got {venv}");
        let uout = unlock_vault(
            &serde_json::json!({ "vault": vv, "password": "test-password-123" }).to_string(),
        );
        let uv: serde_json::Value = serde_json::from_str(&uout).expect("unlock json");
        let sid = uv.get("sessionId").and_then(|x| x.as_u64()).expect("sessionId");
        let d = derive_pubkey(
            &serde_json::json!({ "sessionId": sid, "path": "m/44'/60'/0'/0/0", "curve": "Secp256k1" }).to_string(),
        );
        let dv: serde_json::Value = serde_json::from_str(&d).expect("derive json");
        assert!(dv.get("address").and_then(|x| x.as_str()).unwrap_or("").starts_with("0x"));
        let l = lock_session(&serde_json::json!({ "sessionId": sid }).to_string());
        let lv: serde_json::Value = serde_json::from_str(&l).expect("lock json");
        assert_eq!(lv.get("locked").and_then(|x| x.as_bool()), Some(true));
    }
}
