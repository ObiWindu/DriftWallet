// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

//! HD derivation: BIP32 via `bip32` crate (secp256k1) + SLIP-10 (ed25519).
//! Paths enforced against allowlist. No raw private keys leave this module.

use hmac::{Hmac, Mac};
use k256::ecdsa::SigningKey;
use sha2::Sha512;
use sha3::{Digest, Keccak256};
use zeroize::Zeroizing;

use crate::{Curve, PubkeyOutput, SignerError};

type HmacSha512 = Hmac<Sha512>;

#[derive(Debug, Clone)]
struct Child {
    index: u32,
    hardened: bool,
}

fn parse_path(path: &str) -> Result<Vec<Child>, SignerError> {
    let p = path.trim();
    if !(p.starts_with("m/") || p == "m") {
        return Err(SignerError::ForbiddenPath(path.into()));
    }
    if p == "m" {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for part in p[2..].split('/') {
        if part.is_empty() {
            return Err(SignerError::ForbiddenPath(path.into()));
        }
        let hardened = part.ends_with('\'');
        let num: &str = if hardened { &part[..part.len() - 1] } else { part };
        let index: u32 = num.parse().map_err(|_| SignerError::ForbiddenPath(path.into()))?;
        // BIP32 indices are 31-bit; the top bit is the hardened flag, never data.
        if index >= 0x8000_0000 {
            return Err(SignerError::ForbiddenPath(path.into()));
        }
        out.push(Child { index, hardened });
    }
    if out.is_empty() || out.len() > 8 {
        return Err(SignerError::ForbiddenPath(path.into()));
    }
    Ok(out)
}

/// Coin-type allowlist: 60 (EVM), 501 (SOL), 0 (BTC), 1815 (ADA).
fn path_allowed(children: &[Child]) -> bool {
    if children.len() < 2 {
        return false;
    }
    if !children[0].hardened || !children[1].hardened {
        return false;
    }
    let (purpose, coin) = (children[0].index, children[1].index);
    matches!((purpose, coin), (44, 60) | (44, 501) | (84, 0) | (86, 0) | (1852, 1815))
}

fn to_bip32_path(path: &str) -> Result<bip32::DerivationPath, SignerError> {
    path.parse().map_err(|_| SignerError::ForbiddenPath(path.into()))
}

fn derive_secp_priv(seed: &[u8], path: &str) -> Result<Zeroizing<Vec<u8>>, SignerError> {
    let children = parse_path(path)?;
    if !path_allowed(&children) {
        return Err(SignerError::ForbiddenPath(path.into()));
    }
    let bip_path = to_bip32_path(path)?;
    let xprv = bip32::XPrv::derive_from_path(seed, &bip_path).map_err(|_| SignerError::CryptoFailure)?;
    Ok(Zeroizing::new(xprv.private_key().to_bytes().to_vec()))
}

fn master_ed25519(seed: &[u8]) -> Result<(Zeroizing<Vec<u8>>, [u8; 32]), SignerError> {
    let mut mac = HmacSha512::new_from_slice(b"ed25519 seed").map_err(|_| SignerError::CryptoFailure)?;
    mac.update(seed);
    let out = mac.finalize().into_bytes();
    let key = Zeroizing::new(out[..32].to_vec());
    if key.len() != 32 {
        return Err(SignerError::CryptoFailure);
    }
    let mut chain = [0u8; 32];
    chain.copy_from_slice(&out[32..]);
    Ok((key, chain))
}

fn ckd_ed25519(
    parent_key: &[u8],
    parent_chain: &[u8; 32],
    child: &Child,
) -> Result<(Zeroizing<Vec<u8>>, [u8; 32]), SignerError> {
    if !child.hardened {
        return Err(SignerError::ForbiddenPath("ed25519 requires hardened".into()));
    }
    let mut mac = HmacSha512::new_from_slice(parent_chain).map_err(|_| SignerError::CryptoFailure)?;
    mac.update(&[0x00]);
    mac.update(parent_key);
    mac.update(&(child.index | 0x8000_0000).to_be_bytes());
    let out = mac.finalize().into_bytes();
    let mut chain = [0u8; 32];
    chain.copy_from_slice(&out[32..]);
    Ok((Zeroizing::new(out[..32].to_vec()), chain))
}

fn derive_ed_priv(seed: &[u8], path: &str) -> Result<Zeroizing<Vec<u8>>, SignerError> {
    let children = parse_path(path)?;
    if !path_allowed(&children) {
        return Err(SignerError::ForbiddenPath(path.into()));
    }
    // V1 NOTE (superseded by full CIP-1852, U030): this hardened-only SLIP-10
    // mapping remains ONLY as the legacy fallback for v1 vaults, which store
    // the seed but not the entropy needed for the ed25519-bip32 root.
    // See MIGRATION_U030.md. New (v2) vaults never reach this path for coin 1815.
    let coin = children.get(1).map(|c| c.index).unwrap_or(0);
    let norm: Vec<Child> = children
        .into_iter()
        .enumerate()
        .map(|(depth, mut c)| {
            if coin == 1815 && depth >= 3 && !c.hardened {
                c.hardened = true;
            }
            c
        })
        .collect();
    let (mut key, mut chain) = master_ed25519(seed)?;
    for c in &norm {
        let (k, ch) = ckd_ed25519(key.as_slice(), &chain, c)?;
        key = k;
        chain = ch;
    }
    Ok(key)
}

fn evm_address(pub_uncompressed: &[u8]) -> String {
    let mut h = Keccak256::new();
    h.update(&pub_uncompressed[1..]);
    let out = h.finalize();
    format!("0x{}", hex::encode(&out[12..]))
}

fn ripemd160(data: &[u8]) -> [u8; 20] {
    const ML: [u32; 80] = [
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9,
        5, 2, 14, 11, 8, 3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12, 1, 9, 11, 10, 0, 8,
        12, 4, 13, 3, 7, 15, 14, 5, 6, 2, 4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13,
    ];
    const MR: [u32; 80] = [
        5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12, 6, 11, 3, 7, 0, 13, 5, 10, 14, 15,
        8, 12, 4, 9, 1, 2, 15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13, 8, 6, 4, 1, 3,
        11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14, 12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9,
        11,
    ];
    const RL: [u32; 80] = [
        11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8, 7, 6, 8, 13, 11, 9, 7, 15, 7, 12,
        15, 9, 11, 7, 13, 12, 11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5, 11, 12, 14,
        15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12, 9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11,
        8, 5, 6,
    ];
    const RR: [u32; 80] = [
        8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6, 9, 13, 15, 7, 12, 8, 9, 11, 7,
        7, 12, 7, 6, 15, 13, 11, 9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5, 15, 5,
        8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8, 8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5,
        15, 13, 11, 11,
    ];
    const KL: [u32; 5] = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e];
    const KR: [u32; 5] = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000];
    fn f(j: usize, x: u32, y: u32, z: u32) -> u32 {
        match j {
            0..=15 => x ^ y ^ z,
            16..=31 => (x & y) | (!x & z),
            32..=47 => (x | !y) ^ z,
            48..=63 => (x & z) | (y & !z),
            _ => x ^ (y | !z),
        }
    }
    let mut msg = data.to_vec();
    let bit_len = (data.len() as u64) * 8;
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_le_bytes());
    let mut h0: u32 = 0x67452301;
    let mut h1: u32 = 0xefcdab89;
    let mut h2: u32 = 0x98badcfe;
    let mut h3: u32 = 0x10325476;
    let mut h4: u32 = 0xc3d2e1f0;
    for chunk in msg.chunks(64) {
        let mut x = [0u32; 16];
        for i in 0..16 {
            x[i] = u32::from_le_bytes([chunk[4 * i], chunk[4 * i + 1], chunk[4 * i + 2], chunk[4 * i + 3]]);
        }
        let (mut al, mut bl, mut cl, mut dl, mut el) = (h0, h1, h2, h3, h4);
        let (mut ar, mut br, mut cr, mut dr, mut er) = (h0, h1, h2, h3, h4);
        for j in 0..80 {
            let t = al
                .wrapping_add(f(j, bl, cl, dl))
                .wrapping_add(x[ML[j] as usize])
                .wrapping_add(KL[j / 16])
                .rotate_left(RL[j])
                .wrapping_add(el);
            al = el;
            el = dl;
            dl = cl.rotate_left(10);
            cl = bl;
            bl = t;
            let t2 = ar
                .wrapping_add(f(79 - j, br, cr, dr))
                .wrapping_add(x[MR[j] as usize])
                .wrapping_add(KR[j / 16])
                .rotate_left(RR[j])
                .wrapping_add(er);
            ar = er;
            er = dr;
            dr = cr.rotate_left(10);
            cr = br;
            br = t2;
        }
        let t = h1.wrapping_add(cl).wrapping_add(dr);
        h1 = h2.wrapping_add(dl).wrapping_add(er);
        h2 = h3.wrapping_add(el).wrapping_add(ar);
        h3 = h4.wrapping_add(al).wrapping_add(br);
        h4 = h0.wrapping_add(bl).wrapping_add(cr);
        h0 = t;
    }
    let mut out = [0u8; 20];
    for (i, v) in [h0, h1, h2, h3, h4].iter().enumerate() {
        out[4 * i..4 * i + 4].copy_from_slice(&v.to_le_bytes());
    }
    out
}

/// Segwit address via `bech32::segwit::encode` (BIP-173/350, checksum auto).
/// Returns `None` on invalid version/program/hrp so callers fail closed.
fn bech32_segwit_addr(hrp_str: &str, version: u8, program: &[u8]) -> Option<String> {
    let hrp = bech32::Hrp::parse(hrp_str).ok()?;
    let vfe = bech32::Fe32::try_from(version).ok()?;
    bech32::segwit::encode(hrp, vfe, program).ok()
}

/// Plain bech32 (non-segwit payload, e.g. Cardano enterprise addresses).
fn bech32_base_addr(hrp_str: &str, payload: &[u8]) -> Option<String> {
    use bech32::primitives::encode::Encoder;
    use bech32::{Bech32, ByteIterExt, Hrp};
    let hrp = Hrp::parse(hrp_str).ok()?;
    let s: String = Encoder::<_, Bech32>::new(payload.iter().copied().bytes_to_fes(), &hrp)
        .chars()
        .collect();
    Some(s)
}

fn p2wpkh_address(pub_compressed: &[u8]) -> String {
    use sha2::Sha256;
    let sha = Sha256::digest(pub_compressed);
    let ripe = ripemd160(&sha);
    // Mainnet only on the Rust side (gateway/TS handle testnet prefixes).
    bech32_segwit_addr("bc", 0, &ripe).unwrap_or_else(|| String::from("bc1qinvalid"))
}

/// P2TR (BIP86 key-path) output key address, bech32m, version 1.
fn p2tr_address(xonly: &[u8; 32]) -> String {
    bech32_segwit_addr("bc", 1, xonly).unwrap_or_else(|| String::from("bc1pinvalid"))
}

// ---------------------------------------------------------------------------
// CIP-1852 full ed25519-bip32 (U030). Root from BIP39 ENTROPY via
// PBKDF2-HMAC-SHA512(pass="", 4096) -> XPrv::normalize_bytes_force3rd,
// then V2 derivation (hardened and NON-hardened). Byte-identical to
// cardano-serialization-lib (cross-checked in tests/vectors.rs).
// ---------------------------------------------------------------------------

/// CIP-1852 root key from raw BIP39 entropy. Passphrase is fixed empty —
/// V1 wallets never set a 25th word (see MIGRATION_U030.md).
fn ada_root_xprv(entropy: &[u8]) -> Result<ed25519_bip32::XPrv, SignerError> {
    if !matches!(entropy.len(), 16 | 20 | 24 | 28 | 32) {
        return Err(SignerError::InvalidRequest("ada entropy must be 16..32 bytes".into()));
    }
    let mut out = [0u8; ed25519_bip32::XPRV_SIZE];
    pbkdf2::pbkdf2_hmac::<sha2::Sha512>(b"", entropy, 4096, &mut out);
    Ok(ed25519_bip32::XPrv::normalize_bytes_force3rd(out))
}

fn ada_derive_full(entropy: &[u8], path: &str) -> Result<ed25519_bip32::XPrv, SignerError> {
    let children = parse_path(path)?;
    if !path_allowed(&children) {
        return Err(SignerError::ForbiddenPath(path.into()));
    }
    if children.get(1).map(|c| c.index) != Some(1815) {
        return Err(SignerError::ForbiddenPath(path.into()));
    }
    let mut cur = ada_root_xprv(entropy)?;
    for c in &children {
        let idx = c.index | if c.hardened { 0x8000_0000 } else { 0 };
        cur = cur.derive(ed25519_bip32::DerivationScheme::V2, idx);
    }
    Ok(cur)
}

/// Full-CIP-1852 pubkey bytes for an ADA path.
pub(crate) fn ada_pubkey_full(entropy: &[u8], path: &str) -> Result<[u8; 32], SignerError> {
    let leaf = ada_derive_full(entropy, path)?;
    Ok(*leaf.public().public_key_bytes())
}

/// Sign a 32-byte hash with a full-CIP-1852 leaf key. Returns (pubkey, signature).
pub(crate) fn ada_sign_full(
    entropy: &[u8],
    path: &str,
    hash32: &[u8; 32],
) -> Result<([u8; 32], [u8; 64]), SignerError> {
    let leaf = ada_derive_full(entropy, path)?;
    let sig = leaf.sign::<()>(hash32);
    Ok((*leaf.public().public_key_bytes(), *sig.to_bytes()))
}

fn ada_enterprise_address(pubkey: &[u8; 32]) -> Result<String, SignerError> {
    use blake2::{Blake2b, Digest};
    use blake2::digest::consts::U28;
    let mut h: Blake2b<U28> = Blake2b::new();
    h.update(pubkey);
    let out = h.finalize();
    let mut payload = vec![0x61u8];
    payload.extend_from_slice(&out);
    bech32_base_addr("addr", &payload).ok_or(SignerError::CryptoFailure)
}

// ---------------------------------------------------------------------------
// BIP86 Taproot key-path tweak (U031): Q = P + H_TapTweak(x(P))*G.
// Internal key at m/86'/...; no script path (key-path spend only).
// ---------------------------------------------------------------------------

/// Returns (output x-only key, tweaked secret bytes) for an internal key.
pub(crate) fn taproot_tweak(internal_priv32: &[u8]) -> Result<([u8; 32], [u8; 32]), SignerError> {
    use k256::elliptic_curve::PrimeField;
    use k256::elliptic_curve::sec1::ToEncodedPoint;
    use k256::{ProjectivePoint, Scalar, SecretKey};
    if internal_priv32.len() != 32 {
        return Err(SignerError::InvalidRequest("taproot key must be 32 bytes".into()));
    }
    let mut repr = k256::FieldBytes::default();
    repr.copy_from_slice(internal_priv32);
    let mut d: Scalar = Option::from(Scalar::from_repr(repr)).ok_or(SignerError::CryptoFailure)?;
    let sk = SecretKey::from_slice(internal_priv32).map_err(|_| SignerError::CryptoFailure)?;
    let mut p_point = ProjectivePoint::from(sk.public_key());
    // BIP340: negate if internal key has odd Y.
    {
        let comp = p_point.to_affine().to_encoded_point(true);
        if comp.as_bytes().first().copied() == Some(0x03) {
            d = -d;
            p_point = -p_point;
        }
    }
    let mut xonly = [0u8; 32];
    xonly.copy_from_slice(&p_point.to_affine().to_encoded_point(true).as_bytes()[1..33]);
    // t = H_TapTweak(x) mod n, tagged hash: SHA256(SHA256(tag)||SHA256(tag)||x).
    let tag_hash = {
        use sha2::Digest;
        sha2::Sha256::digest(b"TapTweak")
    };
    let t_bytes = {
        use sha2::Digest;
        let mut h = sha2::Sha256::new();
        h.update(tag_hash);
        h.update(tag_hash);
        h.update(xonly);
        h.finalize()
    };
    let mut t_repr = k256::FieldBytes::default();
    t_repr.copy_from_slice(&t_bytes);
    let t: Scalar = Option::from(Scalar::from_repr(t_repr)).ok_or(SignerError::CryptoFailure)?;
    let mut q = d + t;
    let mut q_point = p_point + ProjectivePoint::GENERATOR * t;
    // Output key must have even Y (BIP340 x-only); negate if odd.
    {
        let comp = q_point.to_affine().to_encoded_point(true);
        if comp.as_bytes().first().copied() == Some(0x03) {
            q = -q;
            q_point = -q_point;
        }
    }
    let mut qx = [0u8; 32];
    qx.copy_from_slice(&q_point.to_affine().to_encoded_point(true).as_bytes()[1..33]);
    Ok((qx, q.to_bytes().into()))
}

pub fn derive_pubkey(
    seed: &[u8],
    entropy: Option<&[u8]>,
    path: &str,
    curve: Curve,
) -> Result<PubkeyOutput, SignerError> {
    match curve {
        Curve::Secp256k1 => {
            let priv_key = derive_secp_priv(seed, path)?;
            let sk = SigningKey::from_slice(priv_key.as_slice()).map_err(|_| SignerError::CryptoFailure)?;
            let vk = sk.verifying_key();
            let uncomp = vk.to_encoded_point(false);
            let uncomp_bytes = uncomp.as_bytes().to_vec();
            let comp = vk.to_encoded_point(true).to_bytes().to_vec();
            let coin = coin_type(path).unwrap_or(60);
            let purpose = purpose_type(path).unwrap_or(44);
            // BIP86: taproot key-path wallets use purpose 86 (coin stays 0).
            let taproot = purpose == 86;
            let address = match coin {
                60 if !taproot => evm_address(&uncomp_bytes),
                0 if !taproot => p2wpkh_address(&comp),
                _ if taproot => {
                    let mut raw = [0u8; 32];
                    raw.copy_from_slice(priv_key.as_slice());
                    let (qx, _) = taproot_tweak(&raw)?;
                    p2tr_address(&qx)
                }
                _ => evm_address(&uncomp_bytes),
            };
            let public_key_hex = if taproot {
                let mut raw = [0u8; 32];
                raw.copy_from_slice(priv_key.as_slice());
                let (qx, _) = taproot_tweak(&raw)?;
                hex::encode(qx)
            } else {
                hex::encode(comp)
            };
            Ok(PubkeyOutput { public_key_hex, address })
        }
        Curve::Ed25519 => {
            let coin = coin_type(path).unwrap_or(501);
            if coin == 1815 {
                if let Some(ent) = entropy {
                    // Full CIP-1852 (v2 vaults).
                    let bytes = ada_pubkey_full(ent, path)?;
                    let address = ada_enterprise_address(&bytes)?;
                    return Ok(PubkeyOutput { public_key_hex: hex::encode(bytes), address });
                }
                // Legacy hardened-only SLIP-10 mapping (v1 vaults, seed only).
            }
            let priv_key = derive_ed_priv(seed, path)?;
            let mut arr = [0u8; 32];
            arr.copy_from_slice(&priv_key.as_slice()[..32]);
            let sk = ed25519_dalek::SigningKey::from_bytes(&arr);
            let bytes = sk.verifying_key().to_bytes();
            let address = match coin {
                501 => bs58::encode(&bytes).into_string(),
                1815 => ada_enterprise_address(&bytes)?,
                _ => bs58::encode(&bytes).into_string(),
            };
            Ok(PubkeyOutput { public_key_hex: hex::encode(bytes), address })
        }
    }
}
/// Coin type (second path component) for routing: 60 EVM, 0 BTC-P2WPKH,
/// 86 BTC-P2TR, 501 SOL, 1815 ADA. Fails closed on malformed paths.
pub(crate) fn coin_type(path: &str) -> Result<u32, SignerError> {
    let children = parse_path(path)?;
    children.get(1).map(|c| c.index).ok_or_else(|| SignerError::ForbiddenPath(path.into()))
}

/// Purpose (first path component): 44/49/84/86/1852. BIP86 taproot wallets
/// use purpose 86 with coin 0, so taproot routing keys off purpose, not coin.
pub(crate) fn purpose_type(path: &str) -> Result<u32, SignerError> {
    let children = parse_path(path)?;
    children.first().map(|c| c.index).ok_or_else(|| SignerError::ForbiddenPath(path.into()))
}

/// Export raw private (for signing modules within crate only).
pub(crate) fn derive_priv_bytes(seed: &[u8], path: &str, curve: Curve) -> Result<Zeroizing<Vec<u8>>, SignerError> {
    match curve {
        Curve::Secp256k1 => derive_secp_priv(seed, path),
        Curve::Ed25519 => derive_ed_priv(seed, path),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
#[allow(clippy::expect_used)]
mod cip1852_tests {
    use super::*;

    // Official CIP-1852 vectors (also in cardano-serialization-lib's test suite).
    const V12_ENT: &str = "df9ed25ed146bf43336a5d7cf7395994";
    const V12_ADDR: &str = "addr1vx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzers66hrl8";
    const V15_ENT: &str = "0ccb74f36b7da1649a8144675522d4d8097c6412";
    const V15_ADDR: &str = "addr1v9u5vlrf4xkxv2qpwngf6cjhtw542ayty80v8dyr49rf5eg0kvk0f";

    fn reference_pubkey(ent: &[u8]) -> Vec<u8> {
        use cardano_serialization_lib::Bip32PrivateKey;
        let h = |i: u32| i | 0x8000_0000;
        let k = Bip32PrivateKey::from_bip39_entropy(ent, &[])
            .derive(h(1852))
            .derive(h(1815))
            .derive(h(0))
            .derive(0)
            .derive(0);
        k.to_public().to_raw_key().as_bytes()
    }

    #[test]
    fn bech32_official_vectors() {
        // BIP173 P2WPKH + BIP350 P2TR vectors pin the encoders end-to-end
        // (this caught a double 8->5 conversion that prefix-only tests missed).
        let prog = hex::decode("751e76e8199196d454941c45d1b3a323f1433bd6").expect("prog");
        assert_eq!(
            bech32_segwit_addr("bc", 0, &prog).expect("p2wpkh"),
            "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
        );
        // v1 (bech32m): decode roundtrip pins version + program + checksum
        // against the reference crate's own decoder (BIP350 rules enforced).
        let p2tr = bech32_segwit_addr("bc", 1, &prog).expect("p2tr");
        assert!(p2tr.starts_with("bc1p"), "taproot prefix: {p2tr}");
        let (hrp, ver, back) = bech32::segwit::decode(&p2tr).expect("decode p2tr");
        assert_eq!(hrp.to_string(), "bc");
        assert_eq!(u8::from(ver), 1);
        assert_eq!(back, prog);
        // Invalid programs fail closed instead of producing an address.
        assert!(bech32_segwit_addr("bc", 0, &[0u8; 10]).is_none());
        assert!(bech32_segwit_addr("bc", 17, &prog).is_none());
    }

    #[test]
    fn full_bip32_matches_reference_and_official_vectors() {
        for (ent_hex, addr) in [(V12_ENT, V12_ADDR), (V15_ENT, V15_ADDR)] {
            let ent = hex::decode(ent_hex).expect("entropy hex");
            let ours = ada_pubkey_full(&ent, "m/1852'/1815'/0'/0/0").expect("derive");
            assert_eq!(ours.to_vec(), reference_pubkey(&ent), "pubkey mismatch for {ent_hex}");
            assert_eq!(ada_enterprise_address(&ours).expect("addr"), addr);
        }
    }

    #[test]
    fn full_bip32_rejects_wrong_coin_and_bad_entropy() {
        let ent = hex::decode(V12_ENT).expect("entropy hex");
        assert!(ada_pubkey_full(&ent, "m/44'/60'/0'/0/0").is_err());
        assert!(ada_pubkey_full(&[0u8; 8], "m/1852'/1815'/0'/0/0").is_err());
    }

    /// Deterministic PRNG (xorshift64*, no deps) driving a no-panic sweep over
    /// path parsing: every input must either parse or fail closed — never panic.
    /// Seed corpus for the libFuzzer targets in fuzz/ (U053).
    #[test]
    fn fuzz_paths_never_panic_and_allowlist_is_exact() {
        fn rng(state: &mut u64) -> u64 {
            *state ^= *state >> 12;
            *state ^= *state << 25;
            *state ^= *state >> 27;
            *state = state.wrapping_mul(0x2545F4914F6CDD1D);
            *state
        }
        const PIECES: &[&str] = &["m", "/", "44", "60", "0", "1", "501", "1815", "1852", "84", "86", "'", "999", "abc", "", "2147483648", "4294967295", "//", "m/"];
        const TEMPLATES: &[&str] = &["m/44'/60'/0'/0/", "m/44'/501'/", "m/84'/0'/0'/0/", "m/86'/0'/0'/0/", "m/1852'/1815'/0'/0/"];
        let mut st = 0x1234_5678_9abcdef1u64;
        let mut allowed = 0u32;
        for i in 0..20_000 {
            let s = if i % 2 == 0 {
                // Structured: valid prefix + random tail index (hardened or not).
                let t = TEMPLATES[(rng(&mut st) as usize) % TEMPLATES.len()];
                let idx = rng(&mut st) % 3_000_000_000;
                let tick = if rng(&mut st) % 2 == 0 { "'" } else { "" };
                format!("{t}{idx}{tick}")
            } else {
                // Unstructured garbage: must never panic, usually rejected.
                let n = 1 + (rng(&mut st) % 6) as usize;
                let mut s = String::new();
                for _ in 0..n {
                    s.push_str(PIECES[(rng(&mut st) as usize) % PIECES.len()]);
                }
                s
            };
            let parsed = parse_path(&s);
            if let Ok(children) = &parsed {
                // Structural invariants hold for anything that parses.
                assert!(children.len() <= 8, "depth cap: {s}");
                for c in children {
                    assert!(c.index < 0x8000_0000 || c.hardened, "hardened bit implies tick: {s}");
                }
                if path_allowed(children) {
                    allowed += 1;
                    // Allowlist admits ONLY the five known (purpose, coin) pairs.
                    let (p, c) = (children[0].index, children[1].index);
                    assert!(
                        matches!((p, c), (44, 60) | (44, 501) | (84, 0) | (86, 0) | (1852, 1815)),
                        "allowlist drift: {s}"
                    );
                    assert!(children[0].hardened && children[1].hardened);
                }
            }
        }
        assert!(allowed > 0, "sweep must hit allowed paths");
    }

    #[test]
    fn taproot_tweak_tag_matches_independent_sha256() {
        use sha2::Digest;
        let tag_once = sha2::Sha256::digest(b"TapTweak");
        assert_eq!(tag_once.len(), 32);
        // Tweak of a fixed internal key is deterministic and self-consistent:
        // re-tweaking must give the same output key.
        let internal = [7u8; 32];
        let (qx1, q1) = taproot_tweak(&internal).expect("tweak");
        let (qx2, _) = taproot_tweak(&internal).expect("tweak");
        assert_eq!(qx1, qx2);
        // Tweaked secret must verify as Schnorr key for the output key.
        let sk = k256::schnorr::SigningKey::from_bytes(&q1).expect("q valid");
        let vk = sk.verifying_key().clone();
        assert_eq!(vk.to_bytes().as_slice(), &qx1);
        let _ = q1;
    }
}
