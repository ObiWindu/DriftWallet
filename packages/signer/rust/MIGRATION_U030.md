# U030/U031 Signer Migration Notes

## U030 — Full CIP-1852 ed25519-bip32 (replaces hardened-only SLIP-10 mapping)

**What changed:** `derive.rs` now implements genuine CIP-1852 derivation for
coin 1815 using the `ed25519-bip32` crate (same primitive family as
`cardano-serialization-lib`):
- Root: PBKDF2-HMAC-SHA512(password=`""`, salt=BIP39 entropy, 4096 rounds) →
  `XPrv::normalize_bytes_force3rd` (identical to CSL `from_bip39_entropy`).
- Descent: `DerivationScheme::V2`, hardened bit `0x80000000` exactly where the
  path has `'`. Both hardened (`1852'/1815'/0'`) and NON-hardened (`/0/0`)
  indices derive per spec — verified byte-identical to CSL on official vectors
  (`derive::cip1852_tests`, 12- and 15-word) plus hardcoded enterprise addresses.
- Signatures use the extended key (`XPrv::sign`), not a clamped 32-byte scalar:
  `ed25519_bip32` signatures verify under the derived `XPub`.
- Bech32 encoder bug fixed as a drive-by (V1 `encode()` double-converted 8→5):
  all Cardano/Bitcoin addresses now go through `bech32::segwit::encode` /
  `Encoder` directly, pinned by BIP173/BIP350 vectors. **V1 bech32 addresses
  (other than EVM) were wrong** — prefix-only tests masked it. No mainnet funds
  were ever held (pre-release), so no fund recovery is needed; testnet wallets
  must be re-derived.

**Vault format:** v2 plaintext = `[0x02, entropy_len, entropy, seed64]`.
- New wallets always store entropy → full CIP-1852.
- v1 vaults (raw 64-byte seed, no entropy) still decrypt and work; ADA paths
  on v1 sessions keep the legacy hardened-only SLIP-10 mapping (same addresses
  as V1 — no silent address change for existing test wallets).
- New wallets and imported external wallets MUST use v2 (creation path always
  writes v2). A v1→v2 upgrade = re-import from phrase (one screen, already in
  onboarding); enforced by showing a "legacy wallet — move funds" banner when
  a v1 vault derives an ADA address (apps read `vault.version`... note: outer
  version stays 1; inner format detected on unlock — apps cannot distinguish
  without unlocking; banner logic: if `derive(1852'/1815'/0'/0/0)` on a v1
  session differs from the v2 derivation of the same phrase, show the banner
  after the user re-enters the phrase in Settings → Migrate).

**Passphrases (25th word):** root KDF uses empty password, matching V1
behaviour. Passphrase-protected wallets remain out of scope (Iteration 3).

## U031 — Taproot key-path (BIP86)

- Paths with purpose 86 (`m/86'/0'/...`) now derive the BIP341 tweaked output
  key `Q = P + H_TapTweak(x(P))*G` (internal key even-Y normalised, output key
  even-Y normalised) and sign with BIP340 Schnorr (`k256::schnorr`).
- Routing keys off **purpose** (86), not coin (coin stays 0) — an earlier
  draft keyed off coin type and never triggered; fixed before release, with a
  regression test (`bitcoin_taproot_keypath` pins address + x-only key + 64B
  Schnorr sig shape).
- Cross-validated: tweak output matches @noble/curves (independent JS impl) for
  the test mnemonic; address encoding matches bitcoinjs-lib P2TR construction
  rules; segwit decoder roundtrips with BIP350 checksum enforcement.
- TS `buildPsbt` accepts P2TR inputs (script `5120||x-only` or `bc1p/tb1p`
  address) with `tapInternalKey`, per-kind vsize (58 vB), RBF preserved.
- Limits: key-path spends only (no script-path / Tapscript); taproot
  **receive** shows P2TR addresses; testnet faucet e2e still required before
  mainnet use (DoD item, needs live network).
