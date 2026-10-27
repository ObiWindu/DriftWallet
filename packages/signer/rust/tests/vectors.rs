// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

use drift_signer::*;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

const TEST_PHRASE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

#[test]
fn bip39_known_vector() {
    assert!(validate_mnemonic(TEST_PHRASE));
    assert!(!validate_mnemonic("abandon abandon about"));
    let m = generate_mnemonic(128).expect("gen");
    assert!(validate_mnemonic(&m));
    assert!(m.split_whitespace().count() == 12);
    let m256 = generate_mnemonic(256).expect("gen256");
    assert!(m256.split_whitespace().count() == 24);
}

#[test]
fn vault_roundtrip_light() {
    let v = entropy_to_vault(TEST_PHRASE, "correct-horse-8!", Argon2Params::test_light()).expect("vault");
    assert_eq!(v.version, 1);
    let h = unlock_vault(&v, b"correct-horse-8!").expect("unlock");
    let pk = derive_pubkey(h, "m/44'/60'/0'/0/0", Curve::Secp256k1).expect("derive");
    assert!(pk.address.starts_with("0x"));
    lock(h).expect("lock");
    // wrong password
    assert!(unlock_vault(&v, b"wrong").is_err());
}

#[test]
fn evm_address_vector() {
    // BIP39 "abandon ... about" / m/44'/60'/0'/0/0.
    // Verified via bip32 crate + keccak256(uncompressed_pubkey)[12..].
    // Priv = 1ab42cc412b618bdea3a599e3c9bae199ebf030895b039e9db1e30dafb12b727
    let v = entropy_to_vault(TEST_PHRASE, "pwd12345!", Argon2Params::test_light()).unwrap();
    let h = unlock_vault(&v, b"pwd12345!").unwrap();
    let pk = derive_pubkey(h, "m/44'/60'/0'/0/0", Curve::Secp256k1).unwrap();
    assert_eq!(pk.address.to_lowercase(), "0x9858effd232b4033e47d90003d41ec34ecaeda94");
    lock(h).unwrap();
}

#[test]
fn evm_sign_eip1559() {
    let v = entropy_to_vault(TEST_PHRASE, "pwd12345!", Argon2Params::test_light()).unwrap();
    let h = unlock_vault(&v, b"pwd12345!").unwrap();
    let req = EvmSignRequest {
        chain_id: 1,
        to: Some(hex_to20("000000000000000000000000000000000000dEaD")),
        value_wei: u256_from_u64(1_000_000_000_000_000),
        nonce: 0,
        gas_limit: 21000,
        max_fee_per_gas: u256_from_u64(20_000_000_000),
        max_priority_fee_per_gas: u256_from_u64(1_000_000_000),
        data: vec![],
        path: "m/44'/60'/0'/0/0".into(),
        typed_data_hash: None,
    };
    let signed = sign_evm(h, req).unwrap();
    assert!(signed.raw_tx_hex.starts_with("0x02"));
    assert!(signed.tx_hash_hex.starts_with("0x"));
    // forbidden chain
    let bad = EvmSignRequest {
        chain_id: 999999,
        to: None,
        value_wei: [0u8; 32],
        nonce: 0,
        gas_limit: 21000,
        max_fee_per_gas: [0u8; 32],
        max_priority_fee_per_gas: [0u8; 32],
        data: vec![],
        path: "m/44'/60'/0'/0/0".into(),
        typed_data_hash: None,
    };
    assert!(sign_evm(h, bad).is_err());
    lock(h).unwrap();
}

#[test]
fn solana_sign() {
    let v = entropy_to_vault(TEST_PHRASE, "pwd12345!", Argon2Params::test_light()).unwrap();
    let h = unlock_vault(&v, b"pwd12345!").unwrap();
    let pk = derive_pubkey(h, "m/44'/501'/0'/0'", Curve::Ed25519).unwrap();
    assert!(!pk.address.is_empty());
    let req = SolanaSignRequest { message_bytes: b"hello drift".to_vec(), path: "m/44'/501'/0'/0'".into() };
    let s = sign_solana(h, req).unwrap();
    assert_eq!(s.public_key_base58, pk.public_key_hex_check());
    lock(h).unwrap();
}

#[test]
fn bitcoin_fee_policy_and_sign() {
    let v = entropy_to_vault(TEST_PHRASE, "pwd12345!", Argon2Params::test_light()).unwrap();
    let h = unlock_vault(&v, b"pwd12345!").unwrap();
    let pk = derive_pubkey(h, "m/84'/0'/0'/0/0", Curve::Secp256k1).unwrap();
    assert!(pk.address.starts_with("bc1q"));
    // minimal valid PSBT envelope: "psbt\xff" + padding
    let mut raw = b"psbt\xff".to_vec();
    raw.extend(vec![0u8; 16]);
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    let psbt = B64.encode(&raw);
    let sighash = "00".repeat(32);
    // fee 500 on 100_000 in (0.5%) ok
    let req = BtcSignRequest {
        inputs: vec![drift_signer::bitcoin::BtcInput { sighash_hex: sighash, path: "m/84'/0'/0'/0/0".into() }],
        psbt_base64: psbt.clone(),
        fee_sats: 500,
        total_in_sats: 100_000,
        total_out_sats: 99_500,
        allow_high_fee: false,
    };
    let s = sign_bitcoin(h, req).unwrap();
    assert_eq!(s.signatures.len(), 1);
    // high fee without allow -> err
    let bad = BtcSignRequest {
        inputs: vec![drift_signer::bitcoin::BtcInput { sighash_hex: "11".repeat(32), path: "m/84'/0'/0'/0/0".into() }],
        psbt_base64: psbt,
        fee_sats: 10_000,
        total_in_sats: 100_000,
        total_out_sats: 90_000,
        allow_high_fee: false,
    };
    assert!(sign_bitcoin(h, bad).is_err());
    lock(h).unwrap();
}

#[test]
fn cardano_sign() {
    let v = entropy_to_vault(TEST_PHRASE, "pwd12345!", Argon2Params::test_light()).unwrap();
    let h = unlock_vault(&v, b"pwd12345!").unwrap();
    let pk = derive_pubkey(h, "m/1852'/1815'/0'/0/0", Curve::Ed25519).unwrap();
    // Pinned: full CIP-1852 for the test mnemonic (v2 vault). Cross-checked
    // against cardano-serialization-lib on official vectors (see derive.rs).
    assert_eq!(pk.public_key_hex, "7ea09a34aebb13c9841c71397b1cabfec5ddf950405293dee496cac2f437480a");
    assert_eq!(pk.address, "addr1vy8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7ss7lxrqp");
    let req = AdaSignRequest { tx_body_cbor_hex: "84a30081825820".to_string() + &"00".repeat(28), witness_paths: vec!["m/1852'/1815'/0'/0/0".into()] };
    let s = sign_cardano(h, req).unwrap();
    assert_eq!(s.witnesses.len(), 1);
    assert_eq!(s.witnesses[0].public_key_hex, pk.public_key_hex);
    lock(h).unwrap();
}

#[test]
fn bitcoin_taproot_keypath() {
    let v = entropy_to_vault(TEST_PHRASE, "pwd12345!", Argon2Params::test_light()).unwrap();
    let h = unlock_vault(&v, b"pwd12345!").unwrap();
    // Pinned: BIP86 for the test mnemonic. Tweak cross-checked against
    // @noble/curves (independent implementation, same output key).
    let pk = derive_pubkey(h, "m/86'/0'/0'/0/0", Curve::Secp256k1).unwrap();
    assert_eq!(pk.public_key_hex, "a60869f0dbcf1dc659c9cecbaf8050135ea9e8cdc487053f1dc6880949dc684c");
    assert_eq!(pk.address, "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr");
    // Key-path spend: 64-byte Schnorr sig (no DER), verifies under output key.
    let mut raw = b"psbt\xff".to_vec();
    raw.extend(vec![0u8; 16]);
    let psbt = B64.encode(&raw);
    let req = BtcSignRequest {
        inputs: vec![drift_signer::bitcoin::BtcInput { sighash_hex: "22".repeat(32), path: "m/86'/0'/0'/0/0".into() }],
        psbt_base64: psbt,
        fee_sats: 500,
        total_in_sats: 100_000,
        total_out_sats: 99_500,
        allow_high_fee: false,
    };
    let s = sign_bitcoin(h, req).unwrap();
    assert_eq!(s.signatures.len(), 1);
    assert_eq!(s.signatures[0].public_key_hex.len(), 64); // x-only
    assert_eq!(s.signatures[0].der_sig_hex.len(), 128); // raw Schnorr, not DER
    lock(h).unwrap();
}

#[test]
fn forbidden_path() {
    let v = entropy_to_vault(TEST_PHRASE, "pwd12345!", Argon2Params::test_light()).unwrap();
    let h = unlock_vault(&v, b"pwd12345!").unwrap();
    assert!(derive_pubkey(h, "m/44'/999'/0'/0/0", Curve::Secp256k1).is_err());
    lock(h).unwrap();
}

fn hex_to20(s: &str) -> [u8; 20] {
    let b = hex::decode(s).unwrap();
    let mut out = [0u8; 20];
    out.copy_from_slice(&b[b.len() - 20..]);
    out
}
fn u256_from_u64(v: u64) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[24..].copy_from_slice(&v.to_be_bytes());
    out
}

// helper to compare solana pubkey encodings
trait Check {
    fn public_key_hex_check(&self) -> String;
}
impl Check for drift_signer::PubkeyOutput {
    fn public_key_hex_check(&self) -> String {
        // derive_pubkey returns hex for ed25519 too; SolanaSigned returns base58.
        // Convert hex -> base58 for comparison.
        let raw = hex::decode(&self.public_key_hex).unwrap();
        bs58::encode(raw).into_string()
    }
}
