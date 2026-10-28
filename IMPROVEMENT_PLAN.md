# DriftWallet — Comprehensive Improvement, Hardening & Enrichment Plan

**Document:** `IMPROVEMENT_PLAN.md`  
**Baseline:** repository at commit `f04b8a8` ("Initial commit: DriftWallet self-custody wallet (V1 + Iteration 2)")  
**Date:** 2026-10-27  
**Scope:** Fix latent defects, close security/quality gaps, improve developer experience, and enrich product capabilities and user value **without breaking the frozen signer boundary** (Rust remains the only key holder).  
**Status:** Planning only. No source changes are made by this document.

---

## 0. How to use this plan

- This plan assumes `SPEC.md`, `ITERATION2_PLAN.md`, `docs/ITERATION2_DOD.md`, `THREAT_MODEL.md`, `SECURITY.md`, and `SECURITY_TEST_EVIDENCE.md` are the locked baselines.
- Tasks are grouped by workstream and ordered within each workstream. Cross-workstream contracts (Zod schemas, signer ABI, storage interfaces) must change in **one commit** with both sides and tests updated.
- Every task ends with the canonical gate: `pnpm -w typecheck && pnpm -w test && cargo test --manifest-path packages/signer/rust/Cargo.toml && cargo clippy --manifest-path packages/signer/rust/Cargo.toml -- -D warnings`.
- Task IDs use the `I###` prefix to distinguish them from V1 `T###` and Iteration 2 `U###` tasks.
- "Must not" rules from `SPEC.md` §1.2 and `ITERATION2_PLAN.md` §5 remain in force unless this plan explicitly proposes a scope change and the user approves it.

---

## 1. Baseline snapshot (verified)

### 1.1 What is genuinely shipped

| Area | Evidence |
|---|---|
| Monorepo + turbo | `pnpm -w typecheck` and `pnpm -w test` green (15 TS projects, 825 `it(...)` cases). |
| Rust signer core | 9 vector tests + 9 unit tests; clippy clean; Argon2id + XChaCha20-Poly1305 vault; BIP32/SLIP-10; EVM EIP-1559 + EIP-712; Solana ed25519; BTC P2WPKH + PSBT + fee policy; ADA CIP-1852 hardened + non-hardened ed25519-bip32; Taproot key-path. |
| Chain adapters (TS) | `packages/chains-*` exist with unit tests; EVM uses viem. |
| Policy engine | phishing, address-poison, fee sanity, infinite-allowance, simulation comparison. |
| Gateway | Fastify skeleton, Zod routes, in-memory TTL cache, token-bucket rate limit, OpenAPI snapshot. |
| Keystore | create/import/unlock/lock, MMKV/Chrome/Firefox adapters, auto-lock timers, biometric helpers. |
| Mobile shell | Route map, store, money helpers, onboarding/send/home/settings view-models and tests. |
| Extension shell | MV3 background, offscreen signer host, content script, injected provider, approval queue, popup/full-page models, connectors, i18n. |
| Features | address book, accounts, swaps, staking, NFTs, notifications view-models + tests. |
| Ledger | EVM/SOL/BTC/ADA intent builders + mocked transport tests. |
| UI design system | tokens, components, i18n, amount helpers, contrast tests. |
| Security tooling | semgrep rules, review script, size/contrast/repro/sbom scripts, SECURITY docs. |

### 1.2 What is still a stub or deferred

| Item | Location | Impact |
|---|---|---|
| Mobile native projects | `apps/mobile` has no `android/` or `ios/`; `android`/`ios` scripts echo stubs. | No real installable app; hardening is documentation-only. |
| Gateway upstreams | `services/gateway/src/index.ts` returns `stub: true` for balances/UTXOs/tokens/broadcast/simulation; prices are `0`. | App cannot show real balances or send real transactions. |
| WASM artifact | `packages/signer/ts/wasm.SHA256` is `PENDING-WASM`; `repro verify` only pins Cargo.lock. | Extension uses injected signer interface in tests, not a real WASM digest. |
| Native signer bindings | `packages/signer/android/DriftSigner.kt`, `packages/signer/ios/DriftSigner.swift`, `packages/signer/ts/src/uniffi.ts` are stubs. | Mobile cannot unlock/sign. |
| Ledger transport | `packages/ledger` has no real `@ledgerhq/*` dependency; mocked transports only. | Hardware wallet support is contract-only. |
| Contrast gate | `scripts/contrast-check.mjs` vacuously passes because `packages/ui/src/tokens.ts` is TS, not JSON. | Accessibility gate is not actually enforced. |
| Extension React version | `apps/extension` uses React 19, while SPEC locks React 18. | Audit surface and dependency drift. |
| Mobile React version | Mobile lists React 18 but has no RN 0.76 project. | Spec mismatch / unverified. |
| Legacy float money | `apps/mobile/src/send.ts` and `quoteFee`/`requiresBiometric` still use JS `number`. | Violates bigint-only money rule for new code; documented exception. |
| Gateway env detection | `upstreamMode()` uses `??`, so an empty env var is treated as "live". | False-live mode; misleading stub flags. |
| Rate limiter state | Token buckets are never evicted. | Unbounded memory growth under many IPs. |
| Simulation | Gateway always returns `diff: null`; policy engine treats null as "unavailable" and never blocks. | Simulation gate is advisory only. |
| Watch-only banner | Contract documented; needs per-screen verification in real shells. | Risk of hidden sign CTAs. |
| E2E runners | Maestro/Playwright specs are stubs or require infra not installed. | No automated end-to-end coverage in CI. |

### 1.3 Verified strengths to preserve

- Typecheck and tests are green; extension bundle is 122.8 KB gz against a 500 KB budget.
- Signer has zeroize, path allowlists, fee policy, and independent Taproot tweak cross-check.
- Money math in extension popup is bigint-only with 10k-case fuzz coverage.
- Semgrep rules exist for secret logging and persistent session storage.
- Storage adapters validate vault blobs with Zod on every load.

---

## 2. Executive summary

DriftWallet has an unusually strong **cryptographic and view-model foundation** but is not yet a shippable consumer wallet: the parts that touch the real world (native shells, live RPC/broadcast, WASM delivery, hardware transport, end-to-end tests) are stubs. The highest-value work is therefore:

1. **Make the wallet actually transact** (live gateway + broadcast + simulation).
2. **Make the wallet actually installable** (native mobile shells + UniFFI + WASM artifact).
3. **Make the safety gates real** (contrast, reproducible WASM, E2E, simulation enforcement).
4. **Enrich user value** (better onboarding, portfolio intelligence, swaps/staking/NFTs UX, notifications, accessibility, multi-account/watch-only, fiat clarity).
5. **Reduce audit risk** (dependency/version alignment, rate limiter hygiene, env truthiness, store-secret enforcement in real shells).

The plan below is organized so that **Stream A (quality gates)** and **Stream C (signer/chains)** can proceed in parallel, while **Stream B (native/mobile)** and **Stream D (extension/dApp)** consume their outputs.

---

## 3. Findings and priority classification

### P0 — must fix before any release candidate

| ID | Finding | Evidence | Proposed fix |
|---|---|---|---|
| F-P0-1 | Contrast gate is vacuous. | `scripts/contrast-check.mjs` exits 0 for TS tokens; `packages/ui/src/contrast.test.ts` only tests helpers. | Make tokens serializable (JSON emitted by build) and fail CI on `< 4.5:1`. |
| F-P0-2 | Gateway env detection bug. | `upstreamMode()` uses `??`. | Use `||` + trim + non-empty validation; add tests for empty strings. |
| F-P0-3 | Simulation never blocks. | Gateway always returns `diff: null`; `compareSimulation` only runs when both claimed and simulated exist. | Implement gateway simulation proxy and require claimed diffs from clients; block on mismatch. |
| F-P0-4 | No real WASM artifact/hash. | `wasm.SHA256` starts with `PENDING-WASM`. | Add `wasm-pack` CI job, record SHA256, enforce `repro verify`. |
| F-P0-5 | No native mobile shell. | No `android/`/`ios/`; scripts are echoes. | Create RN 0.76 bare projects, wire UniFFI + secure storage + FLAG_SECURE. |
| F-P0-6 | Native signer bindings are stubs. | `DriftSigner.kt/.swift/uniffi.ts`. | Implement JSI/TurboModule over C ABI; add lock/unlock/sign tests. |
| F-P0-7 | Extension React version drift. | `apps/extension/package.json` uses React 19; SPEC locks 18. | Downgrade to React 18.3.x and update types/tests. |
| F-P0-8 | Chain packages lack real SDK deps. | `chains-solana` and `chains-cardano` depend only on zod. | Add `@solana/kit`, Mesh/CSL (or gateway-mediated) and implement adapters. |
| F-P0-9 | Gateway is stub-only. | All balance/UTXO/token/broadcast/simulate routes return stubs. | Implement upstream proxies with fallback + cache + zod validation. |
| F-P0-10 | Rate limiter unbounded state. | `buckets` Map never evicted. | Add LRU/TTL eviction and max size; test memory bound. |

### P1 — should fix in the next iteration

| ID | Finding | Proposed fix |
|---|---|---|
| F-P1-1 | Legacy float fee/biometric thresholds in mobile. | Convert `quoteFee` and `requiresBiometric` to bigint cents or isolate behind a lint-suppressed boundary module with tests. |
| F-P1-2 | Firefox session storage lacks adapter. | Implement `FirefoxStorageAdapter.saveSessionId/loadSessionId` using `browser.storage.session` with memory fallback. |
| F-P1-3 | Gateway listens only on loopback. | Make host configurable (`HOST`, default `0.0.0.0` in prod, `127.0.0.1` in dev) with docs. |
| F-P1-4 | Gateway OpenAPI is hand-maintained and incomplete. | Generate OpenAPI from route schemas; add CI diff check. |
| F-P1-5 | Ledger is mock-only. | Integrate `@ledgerhq/*` behind a transport interface; keep mocks as recorded fixtures. |
| F-P1-6 | No real push/notification delivery. | Implement FCM/APNs handlers + hashed-address subscriptions; test with sandbox credentials. |
| F-P1-7 | E2E specs are stubs. | Convert Maestro/Playwright stubs into runnable flows with mock gateway. |
| F-P1-8 | Attestation is documentation-only. | Implement Play Integrity/App Attest calls before seed export; fail closed. |
| F-P1-9 | No mobile i18n wiring. | Add `i18next` + `expo-localization` and move all strings to keys. |
| F-P1-10 | Watch-only banner not mechanically verified. | Add component tests asserting banner + disabled CTAs for every screen. |

### P2 — enrichment and polish

| ID | Finding | Proposed fix |
|---|---|---|
| F-P2-1 | Portfolio lacks history/sparklines. | Add price-history cache + Victory/native charts with no PII beacons. |
| F-P2-2 | Address book lacks trust metadata. | Add first-seen, last-used, verified-contact flags and poison checks. |
| F-P2-3 | Swap allowance UX can be clearer. | Default exact allowance; infinite requires type-to-confirm; show spender + expiry. |
| F-P2-4 | NFT spam filtering is basic. | Add collection allowlist/blocklist + hide suspicious airdrops by default. |
| F-P2-5 | Notifications lack revocation UX. | One-tap revoke per origin + push category controls. |
| F-P2-6 | Accessibility is under-tested. | Add screen-reader labels, dynamic type, keyboard navigation, contrast tokens. |
| F-P2-7 | No in-app education. | Add contextual "why this warning" explainers and security tips. |
| F-P2-8 | No crash/telemetry policy. | Add opt-in, PII-minimized crash reporting with explicit consent. |

---

## 4. Strategic improvement themes

### 4.1 Security-first (unchanged boundary)

- Rust signer remains the only place that imports crypto primitives or touches entropy.
- All new features are view-models or gateway proxies.
- Every new screen/flow gets a `THREAT_MODEL.md` delta before code.
- No plaintext secrets in stores, logs, queries, analytics, or crash reports.

### 4.2 Correctness-first money

- All balances, amounts, fees, and fiat conversions use `bigint`.
- Floats are allowed only at the display boundary and only via integer cents.
- Add a lint rule (`no-float-money`) that flags `Number(` / `parseFloat(` in money paths.

### 4.3 Offline-first reads

- Screens never call `fetch` directly.
- All reads flow through `gateway-client` + query-core cache.
- Stale-while-revalidate with explicit stale indicators.

### 4.4 Progressive enhancement

- Every feature works in "stub mode" with clear UI badges.
- Live capabilities are feature-flagged by environment and user setting.
- No feature blocks wallet creation or receive flows.

### 4.5 Accessibility and localization

- WCAG AA contrast enforced by CI.
- All user-facing strings are i18n keys (EN/FR/ES initially).
- Screen-reader labels and dynamic type on every screen.

---

## 5. Workstreams and detailed tasks

### WS0 — Quality gates and tooling (owner: platform)

**I001 — Make the contrast gate real.**  
- Convert `packages/ui/src/tokens.ts` to emit a build artifact `packages/ui/src/tokens.json` (or move canonical tokens to JSON and generate TS types).  
- Update `scripts/contrast-check.mjs` to require the JSON artifact and fail on parse errors or missing pairs.  
- Add CI step `pnpm contrast:check` as a required check.  
- Acceptance: gate fails on a deliberately bad color pair; passes on current tokens; no vacuous pass.  

**I002 — Fix gateway environment detection.**  
- Replace `??` with `||` and `.trim()`.  
- Add `GATEWAY_ENV_MODE` override for tests.  
- Add unit tests for empty/whitespace env values.  
- Acceptance: empty `ALCHEMY_KEY` yields stub mode.  

**I003 — Bound rate-limiter memory.**  
- Implement LRU eviction with max 10,000 buckets and 10-minute idle expiry.  
- Add metrics for bucket count.  
- Acceptance: unit test inserts 10,001 IPs and asserts eviction; no unbounded growth.  

**I004 — Align dependency versions with SPEC.**  
- Extension: React/React DOM 18.3.x + matching `@types`.  
- Mobile: document RN 0.76 target or update spec if React 19 is intentionally chosen.  
- Add `scripts/check-versions.mjs` check for locked versions.  
- Acceptance: `pnpm check:versions` passes; no version drift.  

**I005 — Build and verify WASM in CI.**  
- Add `wasm-pack build --target bundler` job.  
- Upload artifact; run `pnpm repro record` in CI; commit updated `wasm.SHA256`.  
- Make `repro verify` a required CI gate.  
- Acceptance: SHA256 is a real digest; verify fails if sources change.  

**I006 — Add a float-money lint rule.**  
- Create `no-float-money` rule (or semgrep) flagging `Number(` / `parseFloat(` in `packages/**/money.ts`, `*amount*`, `*fee*`, `*balance*`.  
- Allowlist explicit boundary modules.  
- Acceptance: CI fails on new float money; documented exceptions remain.  

### WS1 — Security and privacy (owner: security)

**I010 — Real attestation before seed export.**  
- Android: Play Integrity token verification server-side.  
- iOS: App Attest assertion.  
- JS records verdict only; export blocked on failure.  
- Acceptance: export fails closed when attestation unavailable; docs updated.  

**I011 — Screenshot and clipboard hardening verification.**  
- Android `FLAG_SECURE` on seed/backup/receive QR screens.  
- iOS app-switcher blur on sensitive screens.  
- Extension clipboard auto-clear after 30s; no persistent copy.  
- Acceptance: Maestro/Playwright assertions + manual evidence.  

**I012 — Watch-only banner enforcement.**  
- Add a shared `WatchOnlyBanner` component.  
- Every screen checks account type; sign/send CTAs disabled (not hidden).  
- Add component tests for home/send/settings/activity.  
- Acceptance: banner present in all four screens; sign path unreachable.  

**I013 — Ledger blind-sign policy.**  
- Render blocking warning for blind sign.  
- Require explicit acknowledge; block infinite approvals.  
- Acceptance: tests for warning + acknowledge + block.  

**I014 — Push security.**  
- Subscriptions use `sha256(address)` only.  
- Add one-tap revoke per origin and category controls.  
- 24-hour signed-tx retention max.  
- Acceptance: gateway tests verify no plaintext address in logs.  

**I015 — Crash reporting consent.**  
- Opt-in only; PII-minimized; no seed/addresses by default.  
- Document data categories in `SECURITY.md`.  
- Acceptance: default off; consent toggle in settings.  

### WS2 — Core money correctness (owner: core)

**I020 — Eliminate legacy float money in mobile.**  
- Convert `quoteFee(medianFeeMinor, …)` and `requiresBiometric(usdAmount, …)` to bigint cents or isolate in `legacy-money.ts` with suppression + tests.  
- Update `send.ts` callers to pass integer cents.  
- Acceptance: no float money outside allowlisted boundary; tests pass.  

**I021 — Unify money helpers across packages.**  
- Publish `@drift/core` money helpers (currently no package entry point).  
- Mobile/UI consume core instead of local copies.  
- Add cross-package round-trip tests.  
- Acceptance: single source of truth; local copies removed.  

**I022 — Fiat pricing robustness.**  
- Support exact decimal strings and integer cents only.  
- Add stale-price indicators and last-updated timestamps.  
- Acceptance: no `Number` on prices in UI.  

**I023 — Fee estimation transparency.**  
- Show fee as amount, fiat, and % of transfer.  
- Warn >5% or >$50; require second confirm.  
- Acceptance: policy-engine tests + UI snapshot.  

### WS3 — Chain adapters and live infrastructure (owner: chains)

**I030 — Real Solana adapter.**  
- Add `@solana/kit` dependency.  
- Implement balance, token accounts, transfer, fee tiers, simulation.  
- Gateway-mediated RPC.  
- Acceptance: devnet transfer test (recorded VCR if no faucet).  

**I031 — Real Cardano adapter.**  
- Add CSL/Mesh dependencies or gateway-mediated CBOR build.  
- Implement UTXO fetch, min-ADA, collateral, delegation.  
- Acceptance: preprod transfer test (recorded VCR).  

**I032 — Bitcoin Esplora integration.**  
- Implement UTXO fetch, fee tiers, RBF, change validation.  
- Acceptance: signet transfer test (recorded VCR).  

**I033 — EVM token lists and custom tokens.**  
- Integrate allowlist + CoinGecko/TrustWallet tokenlists.  
- Verify `decimals()` for custom tokens.  
- Acceptance: token transfer on local fork.  

**I034 — Multi-account support.**  
- Derive index 0..n per chain; account names; watch-only addresses.  
- Acceptance: account switching tests; watch-only banner.  

**I035 — Address resolution.**  
- ENS/SNS/ADA-handle resolution via gateway with cache.  
- Poison check writes to address book.  
- Acceptance: resolution tests + cache TTL.  

### WS4 — Gateway (owner: backend)

**I040 — Live upstream proxy layer.**  
- Implement Alchemy/Infura/Helius/Blockfrost/Esplora proxies with fallback.  
- Zod-validate all upstream responses.  
- Acceptance: integration tests with mocked upstreams.  

**I041 — Real balances/UTXOs/tokens.**  
- Replace stub responses with live data.  
- Keep `stub` flag accurate based on env + upstream health.  
- Acceptance: balance tests return live-shaped data.  

**I042 — Real broadcast.**  
- Submit raw tx; return hash; poll receipt/confirmation.  
- Acceptance: broadcast tests with mocked upstream.  

**I043 — Real simulation.**  
- EVM `eth_call` bundle + balance diff.  
- Solana `simulateTransaction` + balance diff.  
- Gateway returns non-null diff when upstream available.  
- Acceptance: policy-engine blocks on mismatch in E2E.  

**I044 — Prices and history.**  
- CoinGecko/Pyth price proxy with 60s cache.  
- Optional price history for charts.  
- Acceptance: price tests; stale indicators.  

**I045 — Phishing list and token metadata.**  
- Cache Ethereum Phishing Detect + PhishFort lists.  
- Serve token metadata.  
- Acceptance: list refresh tests.  

**I046 — Gateway host/config.**  
- Configurable host/port; healthz includes version + upstream status.  
- Acceptance: `HOST=0.0.0.0` works in container.  

**I047 — OpenAPI generation.**  
- Generate from Fastify schemas; CI diff check.  
- Acceptance: `openapi.json` matches routes.  

### WS5 — Mobile native and UX (owner: mobile)

**I050 — Create real RN 0.76 bare projects.**  
- Add `android/` and `ios/` with Hermes, R8/ProGuard, bundle IDs.  
- Update scripts to real commands.  
- Acceptance: `pnpm mobile:run:android` launches emulator.  

**I051 — Wire UniFFI native signer.**  
- Implement `DriftSigner.kt/.swift` and JSI binding.  
- Unlock/sign round-trip on device.  
- Acceptance: integration tests on emulator/simulator.  

**I052 — Secure storage native.**  
- iOS Keychain with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, non-synchronizable.  
- Android Keystore AES256-GCM, StrongBox if available, biometric required.  
- Acceptance: storage tests + heap snapshot evidence.  

**I053 — Native hardening.**  
- `FLAG_SECURE`, allowBackup false, TLS pinning, jailbreak/root detection.  
- Acceptance: checklist verified.  

**I054 — Onboarding glow-up.**  
- Password strength meter, biometric opt-in, 24-word backup with blur-hide + 3-word quiz, progress indicator.  
- Acceptance: Maestro flow create → backup quiz.  

**I055 — Home/portfolio.**  
- Animated total, chain tabs, asset rows, sparkline stub, pull-to-refresh, empty state, testnet banner.  
- Acceptance: Maestro flow.  

**I056 — Send/receive.**  
- Address book, chain-aware validation, ENS/SOL/ADA resolution, fee picker with fiat + ETA, biometric gate > threshold, QR receive + share.  
- Acceptance: Maestro send flow.  

**I057 — Activity.**  
- Unified history, status, explorer links, spam-token toggle.  
- Acceptance: Maestro activity flow.  

**I058 — Settings.**  
- Auto-lock slider, biometric toggle, network selection, token manager, export seed (password+biometric, timed clear), wipe (double confirm + type-to-confirm), about/licenses.  
- Acceptance: Maestro settings flow.  

**I059 — Mobile i18n.**  
- Add i18next + expo-localization; EN/FR/ES.  
- Acceptance: language switch tests.  

### WS6 — Extension and dApp (owner: extension)

**I060 — React version alignment.**  
- Downgrade to React 18.3.x; update tests/types.  
- Acceptance: typecheck + tests green.  

**I061 — Real WASM signer in offscreen.**  
- Load `wasm-pack` artifact; record SHA256.  
- Acceptance: sign round-trip in Chromium.  

**I062 — Approval queue readability.**  
- Origin + favicon + chain badge, decoded call, simulation diff, fee + fiat, warnings with expanders, approve/reject/always-ask.  
- Acceptance: Playwright approval tests.  

**I063 — Full-page app parity.**  
- Onboarding/home/activity/settings using shared UI.  
- Acceptance: Playwright navigation tests.  

**I064 — dApp connectors.**  
- WalletConnect v2 full session, EIP-6963 discovery, CIP-30 full API, Solana wallet-standard.  
- Acceptance: Playwright dApp spec.  

**I065 — Firefox parity.**  
- `browser.storage.session` adapter + web-ext lint.  
- Acceptance: Firefox loads without errors.  

**I066 — Extension i18n and a11y.**  
- All strings via keys; aria labels; keyboard navigation.  
- Acceptance: contrast + a11y spot-check.  

### WS7 — Feature enrichment (owner: features)

**I070 — Address book v2.**  
- Contacts with per-chain addresses, ENS/SNS/ADA-handle cache, trust metadata, poison checks.  
- Acceptance: unit + Maestro/Playwright flows.  

**I071 — Swaps.**  
- 0x (EVM) + Jupiter (Solana) quotes via gateway; slippage settings; price-impact warnings (>3% warn, >10% block); allowance minimizer.  
- Acceptance: swap flow tests + policy warnings.  

**I072 — Staking.**  
- SOL stake/delegate/undelegate; ADA delegation; EVM liquid staking display; rewards row.  
- Acceptance: staking flow tests.  

**I073 — NFTs.**  
- Gallery + detail; spam filter; ERC-721/1155 + Metaplex transfers through approval screen.  
- Acceptance: NFT transfer tests.  

**I074 — Multi-account and watch-only.**  
- Account names; watch-only banner; private-key import nudge.  
- Acceptance: account tests.  

**I075 — Notifications.**  
- Tx confirmed/failed pushes; price alerts (local evaluation); security pushes with one-tap revoke.  
- Acceptance: notification tests.  

**I076 — Portfolio intelligence.**  
- History charts, allocation, P&L (cost basis optional), stale-price indicators.  
- Acceptance: chart tests; no PII beacons.  

**I077 — Education and explainers.**  
- Contextual "why this warning" expanders; security tips; onboarding education.  
- Acceptance: copy review + i18n.  

### WS8 — Testing, assurance, and release (owner: QA/release)

**I080 — E2E harness.**  
- Maestro mobile flows + Playwright extension flows with mock gateway.  
- Acceptance: CI runs E2E on PRs.  

**I081 — Fuzzing expansion.**  
- `cargo fuzz` targets for path parsing, RLP, PSBT, CBOR.  
- Weekly CI job + corpus.  
- Acceptance: no crashes; corpus committed.  

**I082 — Security evidence automation.**  
- Automate heap/storage snapshot checks where possible.  
- Update `SECURITY_TEST_EVIDENCE.md` per release.  
- Acceptance: evidence doc current.  

**I083 — Release train.**  
- Fastlane lanes, web-ext submit, staged rollout, rollback runbook.  
- SBOM + SLSA provenance.  
- Acceptance: dry-run release.  

**I084 — Performance budgets.**  
- App start <2s; popup <300ms; balance refresh <5s on 4G.  
- Bundle budget enforced.  
- Acceptance: perf tests in CI.  

---

## 6. User-value enrichment backlog (prioritized)

### 6.1 High impact / low risk

1. **Clear transaction previews** — decoded calldata, simulation diff, fee %, warnings.  
2. **Receive flow polish** — QR, copy with auto-clear, share, address book.  
3. **Testnet banner and safety labels** — prevent mainnet mistakes.  
4. **Watch-only accounts** — track portfolios without risk.  
5. **Multi-account** — separate identities per chain.  
6. **Address book with trust metadata** — reduce poisoning.  

### 6.2 Medium impact

7. **Swaps** with exact allowances and price-impact protection.  
8. **Staking** with rewards visibility.  
9. **NFT gallery and transfer**.  
10. **Portfolio charts and allocation**.  
11. **Notifications** for tx status and security events.  
12. **Localization** EN/FR/ES.  

### 6.3 Advanced (Iteration 4+)

13. Hardware wallet support (Ledger).  
14. Fiat on-ramp widget.  
15. Price alerts and watchlists.  
16. Advanced fee controls (custom gas, RBF bump).  
17. Account abstraction / social recovery research (non-goal V1, revisit later).  

---

## 7. Non-functional requirements

| Category | Requirement |
|---|---|
| Security | Rust-only key material; no plaintext secrets in storage/logs; attestation before export. |
| Privacy | Hashed addresses in gateway logs; no PII in analytics/crash by default. |
| Performance | App start <2s; popup <300ms; balance refresh <5s on 4G; extension <500KB gz. |
| Accessibility | WCAG AA contrast; screen-reader labels; dynamic type; keyboard nav. |
| Reliability | Offline-first reads; graceful degradation in stub mode; no data loss on lock. |
| Compatibility | Android/iOS/Chrome/Firefox; EVM x5 + SOL + ADA + BTC. |
| Auditability | Reproducible WASM hash; SBOM; threat model deltas; evidence docs. |

---

## 8. Testing and assurance strategy

### 8.1 Unit

- Money helpers: 10k+ fuzz round-trips.  
- Policy engine: phishing, poison, fee, allowance, simulation.  
- Store/view-models: zod validation, state transitions.  
- Gateway: route validation, cache TTL, rate limit, env mode.  

### 8.2 Integration

- Chain adapters against local forks/devnets/signet/preprod (recorded VCR in CI).  
- Keystore unlock/lock/auto-lock.  
- Offscreen signer round-trip.  

### 8.3 E2E

- Mobile Maestro: create → backup quiz → receive → send.  
- Extension Playwright: connect dApp → EIP-712 → Solana transfer → CIP-30 sign.  
- Hardware: Speculos/recorded fixtures.  

### 8.4 Security

- semgrep `no-secret-log`, `no-store-secrets`.  
- gitleaks, cargo deny/audit, osv-scanner.  
- Heap/storage snapshot procedure.  
- Fuzz targets in CI.  

### 8.5 Performance

- Bundle size gate.  
- Startup/popup timing budgets.  
- Memory bound tests.  

---

## 9. Security review and threat-model deltas

Each Phase U3/U4-style feature must add a delta to `THREAT_MODEL.md`. Minimum deltas:

- **Live gateway:** treat upstreams as untrusted; validate schemas; cache poisoning defenses; rate limits.  
- **WASM delivery:** verify SHA256; CSP; no eval; subresource integrity where applicable.  
- **Native shells:** keychain/keystore access control; biometric binding; screenshot protection.  
- **Push:** hashed addresses only; token rotation; unsubscribe.  
- **Swaps:** allowance minimizer; price-impact limits; spender display.  
- **Staking/NFTs:** decoded instruction display; unknown program warnings.  
- **Hardware wallets:** blind-sign warnings; device pairing security.  

---

## 10. Release and rollout

1. **Internal alpha** — staff only, testnets.  
2. **Closed beta** — 1% rollout, monitoring.  
3. **Open beta** — 10% rollout, feedback.  
4. **GA** — 100% rollout.  

Gates at each stage:
- All CI gates green.  
- No critical audit findings.  
- E2E flows passing.  
- Performance budgets met.  
- Security evidence updated.  

Rollback: feature flags + previous version; documented runbook in `RELEASE.md`.

---

## 11. Metrics and KPIs

| Metric | Target |
|---|---|
| Onboarding completion (create → first receive) | >80% |
| Send success rate | >99% on supported networks |
| Crash-free sessions | >99.5% |
| App start time (mid-tier Android) | <2s |
| Popup open time | <300ms |
| Balance refresh | <5s on 4G |
| Security incidents | 0 critical |
| Test coverage (unit) | >80% on view-models |

---

## 12. Dependencies and sequencing

```text
WS0 quality gates ──┐
WS1 security ───────┼──► WS5 mobile native ──► WS7 features
WS2 money ──────────┤
WS3 chains ─────────┼──► WS6 extension ─────► WS7 features
WS4 gateway ────────┘
WS8 testing/release runs alongside all streams
```

Cross-stream contracts:
- `UnsignedIntent`, `ChainAdapter`, `VaultRef`, `SignerIface`, gateway schemas.
- Any contract change updates schema + both sides + tests in one commit.

---

## 13. 30/60/90-day plan

### Days 0–30 (stabilize and make real)

- I001–I006 quality gates.  
- I002 gateway env fix.  
- I030–I032 real chain adapters (at least balances).  
- I040–I043 gateway live proxy + simulation.  
- I050–I052 native shells + signer wiring (start).  
- I060–I061 extension React + WASM.  

### Days 31–60 (features and UX)

- I053–I058 mobile screens.  
- I062–I066 extension parity.  
- I070–I075 feature enrichment.  
- I080–I082 E2E + fuzz + evidence.  

### Days 61–90 (hardening and release)

- I010–I015 security hardening.  
- I076–I077 portfolio intelligence + education.  
- I083 release train dry-run.  
- I084 performance budgets.  
- External audit preparation.  

---

## 14. Definition of Done (Iteration 3)

- [ ] All P0 findings resolved or explicitly waived with documented rationale.  
- [ ] Native mobile app installs and unlocks/signs on Android/iOS.  
- [ ] Extension loads real WASM and signs in Chromium/Firefox.  
- [ ] Gateway returns live balances/broadcast/simulation when configured.  
- [ ] Simulation mismatch blocks signing in E2E.  
- [ ] Contrast gate enforces AA.  
- [ ] WASM hash is real and verified.  
- [ ] E2E suites run in CI.  
- [ ] Swaps/staking/NFTs have working testnet flows.  
- [ ] Watch-only banner on every screen.  
- [ ] All V1/V2 gates still green.  
- [ ] `THREAT_MODEL.md` deltas for all new features.  
- [ ] Release dry-run succeeds.  

---

## 15. Appendix

### A. Command matrix

```sh
pnpm install
pnpm -w build
pnpm -w typecheck
pnpm -w test
cargo test --manifest-path packages/signer/rust/Cargo.toml
cargo clippy --manifest-path packages/signer/rust/Cargo.toml -- -D warnings
cargo deny check && cargo audit
pnpm ext:review && pnpm size:check && pnpm contrast:check && pnpm repro
pnpm sbom
```

### B. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Native shell delays | High | High | Start early; keep view-models testable without native. |
| Live upstream instability | Medium | High | Fallback providers; cache; stub mode. |
| Audit findings late | Medium | High | Threat model deltas; fuzz; external prep early. |
| Scope creep | High | Medium | Freeze non-goals; prioritize P0/P1. |
| Dependency drift | Medium | Medium | Version check script; lockfile discipline. |

### C. Ownership

| Workstream | Owner |
|---|---|
| WS0 Quality gates | Platform |
| WS1 Security | Security |
| WS2 Core money | Core |
| WS3 Chains | Chains |
| WS4 Gateway | Backend |
| WS5 Mobile | Mobile |
| WS6 Extension | Extension |
| WS7 Features | Features |
| WS8 Testing/Release | QA/Release |

### D. Non-goals (remain out of scope)

Custodial recovery, in-house bridge/L2 contracts, Ordinals minting, options/perps trading, desktop apps, social login. Revisit in Iteration 4.

---

*End of plan.*