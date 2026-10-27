# DriftWallet — Iteration 2 Plan: UI Overhaul, Features, Capabilities
Status: PLAN FOR AI AGENT | Builds on: V1 (SPEC.md, all gates green)
Security posture unchanged: Rust signer remains the ONLY key holder. All new UI
is untrusted view-model code. No plaintext secrets in stores, logs, or queries.

## 0. Where V1 stands (verified baseline)

- Signer core: BIP39/Argon2id+XChaCha vault, BIP32/SLIP-10 derive, EIP-1559 +
  EIP-712, Solana ed25519, BTC P2WPKH+PSBT+fee policy, ADA hardened-only SLIP-10.
- TS: 13 packages, 88 tests; Rust 12 tests; typecheck/clippy/review/SBOM/repro green.
- UI reality: NO rendered UI. `packages/ui` = 2 helpers, mobile store = vanilla
  zustand with no screens, extension = TS models + HTML-shell stubs, portfolio
  math in `popup.ts` uses `Number()` (float — must be replaced with bigint).
- Known V1 debts: ADA non-hardened CIP-1852 unsupported, BTC taproot receive-only,
  no swaps/staking/NFTs, gateway in stub mode, no WASM artifact built in-repo,
  no React anywhere, no i18n/a11y/dark-mode system.

## 1. Design principles for Iteration 2

1. **Signer boundary frozen.** New features may add signer methods (taproot,
   ed25519-bip32) but never move key logic to TS. Every new screen gets a
   `THREAT_MODEL.md` delta line before code.
2. **One design system, three shells.** Tokens → `packages/ui` (React Native +
   React DOM via `react-native-web` or Tamagui-style primitives). Mobile and
   extension consume the same components/view-models.
3. **Bigint-only money.** Fix `popup.ts` float math first (U000 below); new code
   uses `core/formatUnits/parseUnits`. Lint rule: no `parseFloat` on balances.
4. **Offline-first reads.** All balances/prices/history flow through
   `gateway-client` + query-core cache; screens never call `fetch` directly.
5. **Every feature ships with:** unit tests, one Maestro (mobile) or Playwright
   (extension) flow, updated `SECURITY_TEST_EVIDENCE.md` procedure if it touches
   secrets UX (backup/export/sign).

## 2. Locked stack additions (do not substitute without updating this plan)

| Layer | Choice | Why |
|---|---|---|
| Design system | `tamagui@1` (mobile + web primitives, themes) — fallback `nativewind@4` + `react-native-web` if Tamagui audit surface worries you | One component tree for RN + extension; built-in dark mode + tokens |
| Mobile UI | Real RN 0.76 bare shell + `react-navigation@7` + `zustand/react` bindings (store exists) + `react-native-mmkv`, `react-native-reanimated@3` for sheet/number transitions | Keeps V1 storage/security contracts |
| Extension UI | React 18 + Vite + Tailwind (popup + full-page app), `zustand/react` shared store shape with mobile | Popup bundle budget: < 500 KB gzipped JS |
| Charts | `victory-native@41` (mobile, skia) + `lightweight-charts` (extension full-page) | Portfolio history, no PII beacons |
| QR/scan | `react-native-vision-camera@4` (mobile) + `html5-qrcode` (extension) | Camera permission strings required |
| Swap quotes | 0x API (EVM) + Jupiter Ultra (Solana) via gateway (unsigned-quote → policy → signer) | Non-custodial: we never hold routes, only display + sign |
| Staking | Native SOL stake (System/Stake program), ADA delegation cert, EVM via Lido/Rocket Pool router contracts (V2 later: direct validator) | Reuse signer ed25519/secp paths |
| NFTs | SimpleHash/Alchemy NFT API via gateway, display + transfer (ERC-721/1155, Metaplex) | Transfer = existing sign path + new calldata builders |
| Fiat on-ramp | Transak/MoonPay widget (webview, no key sharing) | Off-ramp V2 |
| Push | FCM/APNs via gateway `hashedAddr` subscriptions (already contracted) | Real credentials + background handlers |
| i18n | `i18next` + `expo-localization`, EN/FR/ES first | All user strings via keys from day one |
| A11y | RN `accessibilityLabel` + web `aria-*`, contrast ≥ 4.5:1, dynamic type | Store-release requirement |

## 3. Task order (agent executes sequentially; each ends with gate run)

### Phase U0 — Pay down V1 UI debt (do first)
- **U000 Fix float money.** Replace `Number()` math in `apps/extension/src/popup.ts`
  with bigint + `core/formatUnits`; add property tests (1 wei … 21M BTC).
  Acceptance: `parseUnits(formatUnits(x)) === x` fuzz 10k cases.
- **U001 Design tokens.** `packages/ui`: color (light/dark), type scale, spacing,
  radius, motion; `ThemeProvider`, `Sheet`, `Amount` (bigint-aware),
  `AddressRow` (truncate + identicon + copy-with-autoclear),
  `ChainBadge` (extend existing), `FeePicker` (low/med/high + fiat),
  `PolicyBanner` (allow/warn/block from policy-engine verdicts),
  `BiometricGate` wrapper. Storybook-style `ui/gallery` test page.
  Acceptance: contrast check script passes; 100% unit coverage on Amount.
- **U002 React bindings.** `zustand/react` stores in mobile + extension sharing
  the V1 vanilla shapes; query-core `QueryClientProvider` wiring.
  Acceptance: existing store/query tests still pass; no key material in stores
  (new semgrep rule `no-store-secrets`).

### Phase U1 — Mobile app that looks and feels real
- **U010 Onboarding glow-up.** Create/import/Ledger entry, password strength
  meter (reuse `password.ts`), biometric opt-in, 24-word backup with blur-hide +
  3-word quiz, progress indicator. Reuse `onboarding.ts` state machine.
- **U011 Home.** Portfolio total (animated count-up), chain tabs, asset rows
  (icon, balance, fiat, sparkline stub), pull-to-refresh (query invalidation),
  empty-state + testnet banner (`MAINNET_ENABLED=false`).
- **U012 Send/Receive.** Address book (see U040), chain-aware validation
  (reuse `send.ts`), ENS/SOL-name/ADA-handle resolution via gateway, fee picker
  with fiat + speed ETA, biometric gate > $100, QR receive + share.
- **U013 Activity.** Unified history list (all 8 networks), status (pending/
  confirmed/failed), tap → explorer link, spam-token auto-hide toggle.
- **U014 Settings.** Auto-lock slider (30s–30m), biometric toggle, network
  (mainnet/testnet), token manager, export seed (password+biometric, timed
  auto-clear), wipe wallet (double-confirm + type-to-confirm), about/licenses.
- Acceptance per screen: Maestro flow update in `apps/mobile/maestro/flow.yaml`
  + Desk check on small (SE) and large (tablet) layouts.

### Phase U2 — Extension that matches
- **U020 Popup.** Portfolio mini, network picker, connect status, approve CTA
  badge count; opens full-page on click-through.
- **U021 Approval queue that humans can read.** Origin + favicon + chain badge,
  decoded call (transfer/approve/stake), simulation diff (balance in/out),
  fee + fiat, warnings with "why" expanders, Approve (biometric/WebAuthn where
  available) / Reject / "always ask" per-origin setting.
- **U022 Full-page app.** Onboarding, home, activity, settings — same components
  as mobile via shared `packages/ui`. Deep-link `drift://` parity.
- **U023 dApp connectors.** WalletConnect v2 full session (mobile + extension),
  EIP-6963 multi-injected-provider discovery, CIP-30 full API
  (`getBalance/getUtxos/signTx` with collateral), Solana wallet-standard.
  Acceptance: Playwright `e2e/dapp.spec.ts` extended — connect, EIP-712, Solana
  transfer, CIP-30 sign on local forks.

### Phase U3 — Signer + chain capabilities (Rust-first, TS follows)
- **U030 Full Cardano ed25519-bip32.** Replace the hardened-only V1 mapping with
  audited ed25519-bip32 (CIP-1852 non-hardened change/external chains) in
  `derive.rs`; migration: existing V1 ADA addresses stay valid (keep legacy
  derivation as fallback + "moved funds" banner). Vectors: official
  `cardano-serialization-lib` test fixtures. Remove the V1 deviation note.
- **U031 Bitcoin Taproot send.** P2TR key-path spend in signer + `buildPsbt`
  Taproot inputs; keep P2WPKH default. Fee policy unchanged.
- **U032 Hardware wallets.** Ledger via `@ledgerhq/*` (EVM+SOL+BTC+ADA where
  app supports): blind-sign warnings, device pairing screens, same approval UI
  with "hardware" badge.
- **U033 Transaction simulation.** Gateway `simulate` endpoints (EVM `eth_call`
  bundle + Solana `simulateTransaction`); policy-engine `compareSimulation`
  goes from stub to enforcing. Block on mismatch (already contracted).
- Acceptance: Rust vectors for U030/U031; `cargo deny/audit` clean; WASM
  re-recorded (`repro record`) after signer changes.

### Phase U4 — Features users ask for
- **U040 Address book + names.** Contacts (name → per-chain addresses), ENS/SNS/
  ADA-handle resolution cache, poison-check writes to book ("first seen" trust).
- **U041 Swaps.** Quote → approve-spend → swap flow for EVM (0x) + Solana
  (Jupiter): slippage setting, price-impact warning (>3% warn, >10% block),
  allowance minimizer (exact-amount default, infinite requires type-to-confirm).
- **U042 Staking.** SOL stake/delegate/undelegate, ADA pool delegation,
  EVM liquid-staking display; rewards row in portfolio.
- **U043 NFTs.** Gallery (grid + detail), spam filter, ERC-721/1155 + Metaplex
  transfers through the standard approval screen.
- **U044 Accounts.** Multi-account (index 0..n per chain), account names,
  watch-only addresses (no signer session, "view only" banner everywhere),
  private-key/JSON import (EVM) with immediate "move to seed wallet" nudge.
- **U045 Notifications.** Tx confirmed/failed pushes (hashedAddr only), price
  alerts (local evaluation, server only sends ticks), security pushes (new
  origin connect) with one-tap revoke.
- Acceptance per feature: unit + Maestro/Playwright flow + policy-engine rule
  where money moves + evidence-doc update.

### Phase U5 — Platform + release hardening
- **U050 Real native shells.** Wire UniFFI (`DriftSigner.kt/.swift` exist):
  JSI TurboModule, StrongBox attestation check, `allowBackup=false`,
  `FLAG_SECURE` + screenshot block verified by test, Play Integrity / App
  Attest with `attestation` gate on broadcast (server-side flag).
- **U051 WASM in CI.** `wasm-pack` build job → `repro verify` enforced,
  artifact uploaded per release; Firefox `web-ext lint` + Chrome Web Store
  upload dry-run.
- **U052 Performance budgets.** App start < 2s (mid-tier Android), popup open
  < 300 ms, balance refresh < 5s on 4G; `turbo` bundle-size check on extension
  (< 500 KB gz) + Hermes bytecode size note.
- **U053 Audit prep.** Fuzz targets (`parse_path`, RLP, PSBT magic) via
  `cargo fuzz` nightly job; `cargo geiger` clean; second SBOM (CycloneDX) +
  SLSA provenance on release builds; Immunefi scope draft in `RELEASE.md`.
- **U054 Release train.** Fastlane (mobile) + web-ext submit (extension),
  staged rollout 1%→10%→100% with rollback runbook, status page stub.

## 4. Definition of Done (Iteration 2)

- [ ] New user completes onboarding → backup quiz → receive → send on mobile
  AND extension in < 5 min (timed Maestro/Playwright runs in CI).
- [ ] Swap + stake + NFT transfer each covered by e2e on testnets + policy
  warnings demonstrated (infinite-allowance, high-slippage, poisoned address).
- [ ] ADA external wallets import correctly (U030 vectors + 1 real-wallet test).
- [ ] Ledger signs on EVM + SOL e2e (emulator/speculos or recorded fixture).
- [ ] All V1 gates still green + new: bundle budgets, contrast check,
  `no-store-secrets` semgrep, fuzz corpus in CI, CycloneDX SBOM attached.
- [ ] `THREAT_MODEL.md` delta for every Phase U3/U4 feature; `RELEASE.md`
  rollout log started; support for EN/FR/ES; a11y spot-check recorded.

## 5. Explicit non-goals (Iteration 2)

Custodial recovery, in-house bridge/L2 contracts, Ordinals minting, options/
perps trading, desktop (Electron/Tauri) apps, social login. These stay out to
protect the audit surface; revisit in Iteration 3.

## 6. Suggested agent workstream split (parallelizable)

- Stream A (UI): U000 → U001 → U002 → U010–U014.
- Stream B (Extension+dApp): U020–U023 (needs U001/U002 tokens first).
- Stream C (Signer/chains): U030–U033 (Rust-first; others consume, never block).
- Stream D (Features): U040–U045 (needs U011–U013 + U021 approval screen).
- Stream E (Platform/release): U050–U054 (runs alongside, gates the release).

Build it in order within each stream; cross-stream contracts are the JSON/Zod
schemas already in the repo — if a contract must change, update the schema +
both sides + tests in one commit.
