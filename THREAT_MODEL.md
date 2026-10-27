# Threat Model (STRIDE) — DriftWallet V1

> Required by SPEC §10 before Phase-3 code. This file is the audit entry point.

## Trust boundaries
1. **Signer core (Rust)** — trusted. Holds seed. Exposes sign/derive only.
2. **UI/JS (mobile/extension)** — untrusted. Sees only opaque sessionId + unsigned intents.
3. **Gateway** — untrusted for integrity (client verifies), semi-trusted for availability. Holds zero keys.
4. **OS keystore (Keychain/Keystore/chrome.storage.session)** — trusted for confidentiality of DEK/vault blob at rest.
5. **dApps / WalletConnect peers** — hostile. All inputs zod-validated.

## STRIDE

| Component | Spoofing | Tampering | Repudiation | Info disclosure | DoS | Elevation |
|---|---|---|---|---|---|---|
| SeedVault | Fake biometric prompt → require system BiometricPrompt/WebAuthn only | Vault blob edit → AEAD tag fails closed | — | Heap dump → zeroize + short-lived sessions (5min TTL) | Auto-lock on suspend | Only signer parses paths/chains (allowlist) |
| EVM signing | Fake chainId → Rust allowlist rejects | RLP malleation → re-encode + verify chainId | Signed tx hash logged (hash only, no seed) | — | Nonce gap → gateway nonce-suggest + retry | Typed-data: signer signs 32B digest only after UI decodes |
| BTC | Malicious PSBT (change to attacker) → change must be own address, fee policy | Fee griefing → 5% + 0.01BTC caps + allow_high_fee flag | PSBT logged base64 (no seed) | — | Dust → 546 sats floor | Sign only inputs with own fingerprint |
| Solana | Fake blockhash → simulation required | Balance-diff mismatch → block | — | — | Priority fee tiers | Message length cap 1232B |
| Cardano | Datum confusion → decode + warn unknown Plutus | Body size cap 64KB | — | — | — | Witnesses only for derived keys |
| Extension | Fake origin via postMessage → check `event.origin` + channel `drift-v1` | CSP `script-src 'self'`, no eval | Approval shows origin+favicon+decoded call | Seed screens: no clipboard persist, clear after 30s | SW restart → session in offscreen memory only, re-unlock | Permissions: no `<all_urls>` |
| Supply chain | Typosquat → pnpm lockfile + `cargo deny` + Socket | Reproducible WASM hash recorded | SBOM (cyclonedx) per release | — | Pin providers + fallback RPCs | CI gates (§10) block merge |

## V1 deviations (accepted, tracked)
- **ADA non-hardened paths** mapped to hardened SLIP-10 (CIP-1852 full ed25519-bip32 deferred to T006). New wallets self-consistent; external ADA import compatibility limited. Documented in `derive.rs`.
- **Push** uses `sha256(address)` only; no plaintext linkage in logs (24h signed-tx retention max).

## Audit prep
- `cargo geiger` clean (no unsafe outside reviewed crates), `cargo deny` + `cargo audit` gates.
- Fuzz targets (next): `cargo fuzz` on `parse_path`, RLP decoder, PSBT magic.

## Iteration 2 delta

Covers Phase U3/U4 features (U030–U033, U040–U045). Signer boundary frozen:
all screens below are untrusted view-models; approval text is advisory, the
Rust signer re-validates every intent.

- **New screens data classification:** view-models only. Screens (home, activity,
  swaps, staking, NFTs, address book) receive formatted balances/quotes via
  `gateway-client` + query-core cache and MUST NOT handle seed, entropy, DEK,
  or raw private keys. Enforced by semgrep `no-store-secrets` (CI).
- **WC/EIP-6963/CIP-30 origin trust:** every dApp request carries an asserted
  origin (postMessage `event.origin` + channel `drift-v1`, WC pairing topic,
  CIP-30 `getBalance/getUtxos/signTx` caller). Approval queue shows
  origin + favicon + chain badge; unknown origins default to "always ask".
  Simulation mismatch blocks (policy-engine `compareSimulation` enforcing).
- **Ledger blind-sign policy:** hardware flows render the same approval screen
  with a `hardware` badge. If the device cannot display the full calldata
  (blind sign), the UI shows a blocking warning requiring explicit acknowledge;
  infinite approvals via Ledger are blocked (same rule as software).
- **Swap allowance minimizer:** ERC-20 `approve` defaults to exact quoted amount.
  Infinite/unlimited allowance requires type-to-confirm + is surfaced in the
  simulation diff. Slippage: >3% warn, >10% block (policy-engine).
- **Watch-only banner requirement:** watch-only accounts have no signer session;
  EVERY screen rendering a watch-only address shows a persistent "view only"
  banner, and sign/send CTAs are disabled (not merely hidden).
- **Taproot (U031) + ed25519-bip32 (U030) migration notes:** P2TR key-path spend
  added; P2WPKH remains default. V1 ADA wallets derived via hardened-only
  mapping stay valid — legacy derivation kept as fallback with a "moved funds"
  banner when the ed25519-bip32 path yields a different address. WASM digest
  re-recorded after signer changes (`repro record`); vectors from
  `cardano-serialization-lib` fixtures.
