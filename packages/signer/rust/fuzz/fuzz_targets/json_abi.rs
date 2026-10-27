#![no_main]
// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0


use drift_signer::wasm_bind;
use libfuzzer_sys::fuzz_target;

// Fuzz the JSON-string WASM/FFI ABI: arbitrary input must never panic.
// Heavy paths (Argon2 vault seal) are reached only with well-formed vault
// JSON; the fuzzer spends most cycles on the cheap reject paths.
fuzz_target!(|data: &[u8]| {
    if let Ok(s) = std::str::from_utf8(data) {
        let _ = wasm_bind::validate_mnemonic(s);
        let _ = wasm_bind::capabilities();
        let _ = wasm_bind::derive_pubkey(s);
        let _ = wasm_bind::sign_evm(s);
        let _ = wasm_bind::sign_solana(s);
        let _ = wasm_bind::sign_bitcoin(s);
        let _ = wasm_bind::sign_cardano(s);
        let _ = wasm_bind::entropy_to_vault(s);
        let _ = wasm_bind::unlock_vault(s);
        let _ = wasm_bind::lock_session(s);
    }
});
