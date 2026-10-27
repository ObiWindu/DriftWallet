// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

//! C ABI for UniFFI/JNI hosts (Android/iOS) and foreign callers.
//!
//! All functions take/return JSON strings (`*const c_char`, UTF-8, NUL-terminated).
//! Success and failure are both encoded as JSON: `{...}` or `{"error":"..."}`.
//! Callers MUST release every returned pointer with [`drift_free`].
//!
//! No function ever returns raw seed/mnemonic bytes except the explicit
//! vault-creation helpers that take a user-supplied phrase. `decrypt` of a
//! vault to raw seed is intentionally NOT exposed: use `drift_unlock_vault`
//! which returns an opaque in-memory session handle instead.

use std::ffi::{CStr, CString};
use std::os::raw::c_char;

use crate::{Argon2Params, Curve, EncryptedVault};

// ---------------------------------------------------------------------------
// small JSON helpers (no unwrap/expect: clippy deny in lib.rs)
// ---------------------------------------------------------------------------

fn read_cstr(ptr: *const c_char) -> Result<String, String> {
    if ptr.is_null() {
        return Err("null pointer".to_string());
    }
    // SAFETY: caller guarantees a valid NUL-terminated UTF-8 string.
    let s = unsafe { CStr::from_ptr(ptr) };
    s.to_str().map(|v| v.to_string()).map_err(|_| "invalid utf-8".to_string())
}

fn ok_json(value: serde_json::Value) -> *const c_char {
    let text = serde_json::to_string(&value).unwrap_or_else(|_| "{\"error\":\"encode\"}".to_string());
    CString::new(text).map(|c| c.into_raw() as *const c_char).unwrap_or(std::ptr::null())
}

fn err_json(msg: impl Into<String>) -> *const c_char {
    let text = serde_json::json!({ "error": msg.into() }).to_string();
    CString::new(text).map(|c| c.into_raw() as *const c_char).unwrap_or(std::ptr::null())
}

/// Release a string previously returned by any `drift_*` function.
///
/// # Safety
/// `ptr` must be a pointer returned by this module (or null, which is a no-op).
#[no_mangle]
pub unsafe extern "C" fn drift_free(ptr: *mut c_char) {
    if ptr.is_null() {
        return;
    }
    // SAFETY: upheld by caller contract; paired with CString::into_raw above.
    drop(unsafe { CString::from_raw(ptr) });
}

// ---------------------------------------------------------------------------
// capabilities
// ---------------------------------------------------------------------------

fn capabilities_value() -> serde_json::Value {
    serde_json::json!({
        "functions": [
            "generate_mnemonic",
            "validate_mnemonic",
            "entropy_to_vault",
            "unlock_vault",
            "lock",
            "derive_pubkey",
            "sign_evm",
            "sign_solana",
            "sign_bitcoin",
            "sign_cardano"
        ],
        "allowedChains": [1, 56, 137, 42161, 8453, 11155111, 97, 80002, 421614, 84532],
        "allowedPaths": [
            "m/44'/60'/ACCOUNT'/CHANGE/INDEX",
            "m/44'/501'/ACCOUNT'/CHANGE'",
            "m/84'/0'/ACCOUNT'/CHANGE/INDEX",
            "m/86'/0'/ACCOUNT'/CHANGE/INDEX",
            "m/1852'/1815'/ACCOUNT'/CHAIN/INDEX"
        ],
        "curves": ["Secp256k1", "Ed25519"],
        "abi": "json-string",
        "version": 1
    })
}

/// JSON describing the signer surface: function list + allowed chains/paths.
///
/// Caller frees with `drift_free`.
#[no_mangle]
pub extern "C" fn drift_capabilities() -> *const c_char {
    ok_json(capabilities_value())
}

// ---------------------------------------------------------------------------
// vault JSON codec
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct Argon2Json {
    #[serde(rename = "mKib")]
    m_kib: u32,
    #[serde(rename = "tCost")]
    t_cost: u32,
    #[serde(rename = "pCost")]
    p_cost: u32,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct VaultJson {
    version: u8,
    #[serde(rename = "saltHex")]
    salt_hex: String,
    #[serde(rename = "nonceHex")]
    nonce_hex: String,
    #[serde(rename = "ciphertextHex")]
    ciphertext_hex: String,
    argon2: Argon2Json,
}

fn vault_from_json(v: &VaultJson) -> Result<EncryptedVault, String> {
    if v.version != 1 {
        return Err("invalid vault version".to_string());
    }
    let salt = hex::decode(v.salt_hex.trim()).map_err(|_| "bad saltHex".to_string())?;
    let nonce = hex::decode(v.nonce_hex.trim()).map_err(|_| "bad nonceHex".to_string())?;
    let ct = hex::decode(v.ciphertext_hex.trim()).map_err(|_| "bad ciphertextHex".to_string())?;
    if salt.len() != 32 {
        return Err("salt must be 32 bytes".to_string());
    }
    if nonce.len() != 24 {
        return Err("nonce must be 24 bytes".to_string());
    }
    let mut salt_arr = [0u8; 32];
    salt_arr.copy_from_slice(&salt);
    let mut nonce_arr = [0u8; 24];
    nonce_arr.copy_from_slice(&nonce);
    Ok(EncryptedVault {
        version: 1,
        salt: salt_arr,
        nonce: nonce_arr,
        ciphertext: ct,
        argon2: Argon2Params { m_kib: v.argon2.m_kib, t_cost: v.argon2.t_cost, p_cost: v.argon2.p_cost },
    })
}

fn vault_to_json(v: &EncryptedVault) -> serde_json::Value {
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
        _ => Err("unknown curve (want Secp256k1|Ed25519)".to_string()),
    }
}

// hex / u256 helpers ---------------------------------------------------------

fn hex_trimmed(s: &str) -> &str {
    let t = s.trim();
    t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")).unwrap_or(t)
}

fn parse_hex_bytes(s: &str, want: Option<usize>, what: &str) -> Result<Vec<u8>, String> {
    let b = hex::decode(hex_trimmed(s)).map_err(|_| format!("bad {what} hex"))?;
    if let Some(n) = want {
        if b.len() != n {
            return Err(format!("{what} must be {n} bytes"));
        }
    }
    Ok(b)
}

fn parse_hex32(s: &str, what: &str) -> Result<[u8; 32], String> {
    let b = parse_hex_bytes(s, Some(32), what)?;
    let mut out = [0u8; 32];
    out.copy_from_slice(&b);
    Ok(out)
}

fn parse_hex20_opt(s: &str) -> Result<[u8; 20], String> {
    let b = parse_hex_bytes(s, Some(20), "address")?;
    let mut out = [0u8; 20];
    out.copy_from_slice(&b);
    Ok(out)
}

/// Decimal u256 string (e.g. wei) -> 32B big-endian.
fn parse_u256_dec(s: &str) -> Result<[u8; 32], String> {
    let t = s.trim();
    if t.is_empty() || !t.bytes().all(|b| b.is_ascii_digit()) {
        return Err("bad u256 decimal".to_string());
    }
    // manual decimal -> 256-bit to avoid new crates
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

fn parse_u64_str(s: &str, what: &str) -> Result<u64, String> {
    s.trim().parse::<u64>().map_err(|_| format!("bad {what}"))
}

// ---------------------------------------------------------------------------
// exposed helpers — every one is JSON in / JSON out
// ---------------------------------------------------------------------------

/// `{"strengthBits":128|256}` -> `{"mnemonic":"..."}` or `{"error":...}`.
#[no_mangle]
pub extern "C" fn drift_generate_mnemonic(req: *const c_char) -> *const c_char {
    let body = match read_cstr(req) {
        Ok(v) => v,
        Err(e) => return err_json(e),
    };
    let v: serde_json::Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return err_json("invalid json"),
    };
    let strength = v.get("strengthBits").and_then(|x| x.as_u64()).unwrap_or(0) as u16;
    match crate::generate_mnemonic(strength) {
        Ok(m) => ok_json(serde_json::json!({ "mnemonic": m })),
        Err(e) => err_json(e.to_string()),
    }
}

/// `{"phrase":"..."}` -> `{"valid":true|false}`.
#[no_mangle]
pub extern "C" fn drift_validate_mnemonic(req: *const c_char) -> *const c_char {
    let body = match read_cstr(req) {
        Ok(v) => v,
        Err(e) => return err_json(e),
    };
    let v: serde_json::Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return err_json("invalid json"),
    };
    let phrase = v.get("phrase").and_then(|x| x.as_str()).unwrap_or("");
    ok_json(serde_json::json!({ "valid": crate::validate_mnemonic(phrase) }))
}

/// `{"phrase":"...","password":"...","lightKdf":true}` -> vault JSON or `{"error":...}`.
/// `lightKdf=true` selects the fast test KDF; production uses the default (heavy) params.
#[no_mangle]
pub extern "C" fn drift_entropy_to_vault(req: *const c_char) -> *const c_char {
    let body = match read_cstr(req) {
        Ok(v) => v,
        Err(e) => return err_json(e),
    };
    let v: serde_json::Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return err_json("invalid json"),
    };
    let phrase = match v.get("phrase").and_then(|x| x.as_str()) {
        Some(p) => p.to_string(),
        None => return err_json("missing phrase"),
    };
    let password = match v.get("password").and_then(|x| x.as_str()) {
        Some(p) => p.to_string(),
        None => return err_json("missing password"),
    };
    let light = v.get("lightKdf").and_then(|x| x.as_bool()).unwrap_or(false);
    let params = if light { Argon2Params::test_light() } else { Argon2Params::default() };
    match crate::entropy_to_vault(&phrase, &password, params) {
        Ok(vault) => ok_json(vault_to_json(&vault)),
        Err(e) => err_json(e.to_string()),
    }
}

/// `{"vault":{...},"password":"..."}` -> `{"sessionId":N}` or `{"error":...}`.
/// The raw seed never leaves Rust; only the opaque handle is returned.
#[no_mangle]
pub extern "C" fn drift_unlock_vault(req: *const c_char) -> *const c_char {
    let body = match read_cstr(req) {
        Ok(v) => v,
        Err(e) => return err_json(e),
    };
    let v: serde_json::Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return err_json("invalid json"),
    };
    let vault_v = match v.get("vault") {
        Some(x) => x.clone(),
        None => return err_json("missing vault"),
    };
    let vault_json: VaultJson = match serde_json::from_value(vault_v) {
        Ok(x) => x,
        Err(_) => return err_json("bad vault shape"),
    };
    let vault = match vault_from_json(&vault_json) {
        Ok(x) => x,
        Err(e) => return err_json(e),
    };
    let password = match v.get("password").and_then(|x| x.as_str()) {
        Some(p) => p.to_string(),
        None => return err_json("missing password"),
    };
    match crate::unlock_vault(&vault, password.as_bytes()) {
        Ok(h) => ok_json(serde_json::json!({ "sessionId": h })),
        Err(e) => err_json(e.to_string()),
    }
}

/// `{"sessionId":N}` -> `{"locked":true}` or `{"error":...}`. Zeroizes the session.
#[no_mangle]
pub extern "C" fn drift_lock(req: *const c_char) -> *const c_char {
    let body = match read_cstr(req) {
        Ok(v) => v,
        Err(e) => return err_json(e),
    };
    let v: serde_json::Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return err_json("invalid json"),
    };
    let h = match v.get("sessionId").and_then(|x| x.as_u64()) {
        Some(x) => x,
        None => return err_json("missing sessionId"),
    };
    match crate::lock(h) {
        Ok(()) => ok_json(serde_json::json!({ "locked": true })),
        Err(e) => err_json(e.to_string()),
    }
}

/// `{"sessionId":N,"path":"m/...","curve":"Secp256k1|Ed25519"}`
/// -> `{"publicKeyHex":"...","address":"..."}` or `{"error":...}`.
#[no_mangle]
pub extern "C" fn drift_derive_pubkey(req: *const c_char) -> *const c_char {
    let body = match read_cstr(req) {
        Ok(v) => v,
        Err(e) => return err_json(e),
    };
    let v: serde_json::Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return err_json("invalid json"),
    };
    let h = match v.get("sessionId").and_then(|x| x.as_u64()) {
        Some(x) => x,
        None => return err_json("missing sessionId"),
    };
    let path = match v.get("path").and_then(|x| x.as_str()) {
        Some(p) => p.to_string(),
        None => return err_json("missing path"),
    };
    let curve = match v.get("curve").and_then(|x| x.as_str()) {
        Some(c) => match parse_curve(c) {
            Ok(c) => c,
            Err(e) => return err_json(e),
        },
        None => return err_json("missing curve"),
    };
    match crate::derive_pubkey(h, &path, curve) {
        Ok(o) => ok_json(serde_json::json!({ "publicKeyHex": o.public_key_hex, "address": o.address })),
        Err(e) => err_json(e.to_string()),
    }
}

/// EVM signing. Request mirrors the TS `EvmSignRequest` plus `sessionId`:
/// `{"sessionId":N,"chainId":1,"to":"0x.."|null,"valueWei":"...","nonce":0,
///   "gasLimit":"21000","maxFeePerGasWei":"...","maxPriorityFeePerGasWei":"...",
///   "dataHex":"0x","path":"m/44'/60'/...","typedDataHashHex":"0x.."|null}`
#[no_mangle]
pub extern "C" fn drift_sign_evm(req: *const c_char) -> *const c_char {
    let body = match read_cstr(req) {
        Ok(v) => v,
        Err(e) => return err_json(e),
    };
    let v: serde_json::Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return err_json("invalid json"),
    };
    let parsed = (|| -> Result<crate::EvmSignRequest, String> {
        let get = |k: &str| v.get(k);
        let chain_id = get("chainId").and_then(|x| x.as_u64()).ok_or("missing chainId".to_string())?;
        let to = match get("to") {
            Some(serde_json::Value::Null) | None => None,
            Some(serde_json::Value::String(s)) if s.is_empty() => None,
            Some(serde_json::Value::String(s)) => Some(parse_hex20_opt(s)?),
            _ => return Err("bad to".to_string()),
        };
        let value_wei = parse_u256_dec(get("valueWei").and_then(|x| x.as_str()).unwrap_or("0"))?;
        let nonce = get("nonce").and_then(|x| x.as_u64()).ok_or("missing nonce".to_string())?;
        let gas_limit = match get("gasLimit") {
            Some(serde_json::Value::Number(n)) => n.as_u64().ok_or("bad gasLimit".to_string())?,
            Some(serde_json::Value::String(s)) => parse_u64_str(s, "gasLimit")?,
            _ => return Err("missing gasLimit".to_string()),
        };
        let max_fee = parse_u256_dec(get("maxFeePerGasWei").and_then(|x| x.as_str()).unwrap_or("0"))?;
        let max_prio =
            parse_u256_dec(get("maxPriorityFeePerGasWei").and_then(|x| x.as_str()).unwrap_or("0"))?;
        let data_hex = get("dataHex").and_then(|x| x.as_str()).unwrap_or("0x");
        let data = hex::decode(hex_trimmed(data_hex)).map_err(|_| "bad dataHex".to_string())?;
        let path = get("path").and_then(|x| x.as_str()).ok_or("missing path".to_string())?.to_string();
        let typed = match get("typedDataHashHex") {
            Some(serde_json::Value::Null) | None => None,
            Some(serde_json::Value::String(s)) if s.is_empty() => None,
            Some(serde_json::Value::String(s)) => Some(parse_hex32(s, "typedDataHash")?),
            _ => return Err("bad typedDataHashHex".to_string()),
        };
        Ok(crate::EvmSignRequest {
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
        })
    })();
    let evm_req = match parsed {
        Ok(r) => r,
        Err(e) => return err_json(e),
    };
    let h = match v.get("sessionId").and_then(|x| x.as_u64()) {
        Some(x) => x,
        None => return err_json("missing sessionId"),
    };
    match crate::sign_evm(h, evm_req) {
        Ok(s) => ok_json(serde_json::json!({
            "rawTxHex": s.raw_tx_hex, "txHashHex": s.tx_hash_hex,
            "v": s.v, "rHex": s.r_hex, "sHex": s.s_hex
        })),
        Err(e) => err_json(e.to_string()),
    }
}

/// `{"sessionId":N,"messageBytesHex":"...","path":"m/44'/501'/..."}`.
#[no_mangle]
pub extern "C" fn drift_sign_solana(req: *const c_char) -> *const c_char {
    let body = match read_cstr(req) {
        Ok(v) => v,
        Err(e) => return err_json(e),
    };
    let v: serde_json::Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return err_json("invalid json"),
    };
    let h = match v.get("sessionId").and_then(|x| x.as_u64()) {
        Some(x) => x,
        None => return err_json("missing sessionId"),
    };
    let msg_hex = match v.get("messageBytesHex").and_then(|x| x.as_str()) {
        Some(s) => s,
        None => return err_json("missing messageBytesHex"),
    };
    let msg = match hex::decode(hex_trimmed(msg_hex)) {
        Ok(b) => b,
        Err(_) => return err_json("bad messageBytesHex"),
    };
    let path = match v.get("path").and_then(|x| x.as_str()) {
        Some(p) => p.to_string(),
        None => return err_json("missing path"),
    };
    match crate::sign_solana(h, crate::SolanaSignRequest { message_bytes: msg, path }) {
        Ok(s) => ok_json(serde_json::json!({
            "signatureBase58": s.signature_base58, "publicKeyBase58": s.public_key_base58
        })),
        Err(e) => err_json(e.to_string()),
    }
}

/// `{"sessionId":N,"inputs":[{"sighashHex":"...","path":"..."}],
///   "psbtBase64":"...","feeSats":"500","totalInSats":"100000",
///   "totalOutSats":"99500","allowHighFee":false}`.
#[no_mangle]
pub extern "C" fn drift_sign_bitcoin(req: *const c_char) -> *const c_char {
    let body = match read_cstr(req) {
        Ok(v) => v,
        Err(e) => return err_json(e),
    };
    let v: serde_json::Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return err_json("invalid json"),
    };
    let h = match v.get("sessionId").and_then(|x| x.as_u64()) {
        Some(x) => x,
        None => return err_json("missing sessionId"),
    };
    let str_u64 = |key: &str| -> Result<u64, String> {
        match v.get(key) {
            Some(serde_json::Value::Number(n)) => n.as_u64().ok_or(format!("bad {key}")),
            Some(serde_json::Value::String(s)) => parse_u64_str(s, key),
            _ => Err(format!("missing {key}")),
        }
    };
    let inputs_v = match v.get("inputs").and_then(|x| x.as_array()) {
        Some(a) => a.clone(),
        None => return err_json("missing inputs"),
    };
    let mut inputs = Vec::with_capacity(inputs_v.len());
    for item in &inputs_v {
        let sighash_hex = match item.get("sighashHex").and_then(|x| x.as_str()) {
            Some(s) => s.to_string(),
            None => return err_json("bad input sighashHex"),
        };
        let path = match item.get("path").and_then(|x| x.as_str()) {
            Some(s) => s.to_string(),
            None => return err_json("bad input path"),
        };
        inputs.push(crate::bitcoin::BtcInput { sighash_hex, path });
    }
    let psbt_base64 = match v.get("psbtBase64").and_then(|x| x.as_str()) {
        Some(s) => s.to_string(),
        None => return err_json("missing psbtBase64"),
    };
    let fee_sats = match str_u64("feeSats") {
        Ok(x) => x,
        Err(e) => return err_json(e),
    };
    let total_in = match str_u64("totalInSats") {
        Ok(x) => x,
        Err(e) => return err_json(e),
    };
    let total_out = match str_u64("totalOutSats") {
        Ok(x) => x,
        Err(e) => return err_json(e),
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
            ok_json(serde_json::json!({ "signatures": sigs }))
        }
        Err(e) => err_json(e.to_string()),
    }
}

/// `{"sessionId":N,"txBodyCborHex":"...","witnessPaths":[...]}`.
#[no_mangle]
pub extern "C" fn drift_sign_cardano(req: *const c_char) -> *const c_char {
    let body = match read_cstr(req) {
        Ok(v) => v,
        Err(e) => return err_json(e),
    };
    let v: serde_json::Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return err_json("invalid json"),
    };
    let h = match v.get("sessionId").and_then(|x| x.as_u64()) {
        Some(x) => x,
        None => return err_json("missing sessionId"),
    };
    let tx_hex = match v.get("txBodyCborHex").and_then(|x| x.as_str()) {
        Some(s) => s.to_string(),
        None => return err_json("missing txBodyCborHex"),
    };
    let paths_v = match v.get("witnessPaths").and_then(|x| x.as_array()) {
        Some(a) => a.clone(),
        None => return err_json("missing witnessPaths"),
    };
    let mut paths = Vec::with_capacity(paths_v.len());
    for p in &paths_v {
        match p.as_str() {
            Some(s) => paths.push(s.to_string()),
            None => return err_json("bad witnessPaths"),
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
            ok_json(serde_json::json!({ "witnesses": w, "txBodyHashHex": s.tx_body_hash_hex }))
        }
        Err(e) => err_json(e.to_string()),
    }
}

// ---------------------------------------------------------------------------
// unit test: capabilities JSON parses + allowlists match lib.rs / derive.rs
// ---------------------------------------------------------------------------

#[cfg(test)]
#[allow(clippy::unwrap_used)]
#[allow(clippy::expect_used)]
mod ffi_tests {
    use super::*;
    use crate::is_chain_allowed;
    use std::ffi::CStr;

    fn capabilities_string() -> String {
        let ptr = drift_capabilities();
        assert!(!ptr.is_null());
        let s = unsafe { CStr::from_ptr(ptr).to_string_lossy().into_owned() };
        unsafe { drift_free(ptr as *mut c_char) };
        s
    }

    #[test]
    fn capabilities_json_parses_and_path_allowlist_matches_lib() {
        let s = capabilities_string();
        let v: serde_json::Value = serde_json::from_str(&s).expect("capabilities is JSON");

        let fns = v.get("functions").and_then(|x| x.as_array()).expect("functions array");
        for name in [
            "generate_mnemonic",
            "validate_mnemonic",
            "entropy_to_vault",
            "unlock_vault",
            "lock",
            "derive_pubkey",
            "sign_evm",
            "sign_solana",
            "sign_bitcoin",
            "sign_cardano",
        ] {
            assert!(fns.iter().any(|f| f.as_str() == Some(name)), "missing fn {name}");
        }

        // every advertised chain must be accepted by lib.rs
        let chains = v.get("allowedChains").and_then(|x| x.as_array()).expect("chains array");
        assert!(!chains.is_empty());
        for c in chains {
            let id = c.as_u64().expect("chain id u64");
            assert!(is_chain_allowed(id), "chain {id} not allowed by lib.rs");
        }
        // spot-check well-known chains are present
        for want in [1u64, 8453, 11155111] {
            assert!(chains.iter().any(|c| c.as_u64() == Some(want)), "missing chain {want}");
        }

        // advertised path templates must cover the derive.rs allowlist:
        // (44,60) (44,501) (84,0) (86,0) (1852,1815)
        let paths = v.get("allowedPaths").and_then(|x| x.as_array()).expect("paths array");
        assert_eq!(paths.len(), 5);
        let joined = serde_json::to_string(&paths).expect("stringify paths");
        for pat in ["44'/60'", "44'/501'", "84'/0'", "86'/0'", "1852'/1815'"] {
            assert!(joined.contains(pat), "allowlist missing {pat}");
        }

        // round-trip one helper through the C ABI (no seed involved)
        let req = CString::new(r#"{"phrase":"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"}"#)
            .expect("cstring");
        let out = drift_validate_mnemonic(req.as_ptr());
        assert!(!out.is_null());
        let text = unsafe { CStr::from_ptr(out).to_string_lossy().into_owned() };
        unsafe { drift_free(out as *mut c_char) };
        let parsed: serde_json::Value = serde_json::from_str(&text).expect("validate json");
        assert_eq!(parsed.get("valid").and_then(|x| x.as_bool()), Some(true));
    }
}
