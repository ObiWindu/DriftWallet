# DriftWallet — Security Test Evidence (T011/T012)

How to reproduce the checks below. All commands run offline from the repo root
unless noted. Evidence files live in `sbom.json` (see `pnpm sbom`) and CI logs.

## 1. Heap / storage snapshot procedure

Goal: prove no seed / private key / BIP-39 entropy ever lands in cleartext
persistent storage (MMKV, chrome.storage, localStorage, IndexedDB).

### Mobile (MMKV + Keychain/Keystore)

1. Build a debug APK/IPA with a test mnemonic (NEVER a real seed).
2. Walk the Maestro flow: `apps/mobile/maestro/flow.yaml` (create → receive → send).
3. Dump app storage while the app is backgrounded:
   - Android: `adb shell run-as com.drift.wallet ls files/` then pull MMKV files;
     `adb shell dumpsys meminfo com.drift.wallet` for heap baseline.
   - iOS: Xcode Devices → Download Container → inspect `mmkv/` + Keychain group.
4. Search dumps for seed material:
   ```sh
   strings app-mmkv-dump.bin | grep -iE 'abandon|mnemonic|entropy|0x[0-9a-f]{64}' && echo LEAK || echo CLEAN
   rg -i 'abandon|bip39|private[_-]?key' mmkv-dump/ || echo CLEAN
   ```
5. Expected: `CLEAN`. Only ciphertext + `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`
   key refs are present.

### Extension (chrome.storage / offscreen memory)

1. Load unpacked `apps/extension/dist` in Chrome with a test seed.
2. Approve one `eth_sendTransaction` via the approval queue, then lock the wallet.
3. Dump extension storage:
   ```js
   chrome.storage.local.get(null, console.log); // expect: no seed/entropy keys
   ```
   plus DevTools → Application → Local Storage / IndexedDB for the extension origin.
4. Search: `rg -i 'mnemonic|entropy|private[_-]?key' storage-dump.json || echo CLEAN`.
5. Offscreen session check: `chrome.runtime.sendMessage({kind:'lock'})` then attempt
   `signEth` → must return `{ ok: false, error: 'locked' }` (memory-only session).

## 2. Checklist results (current release candidate)

| Check | Tool / command | Result |
|---|---|---|
| No seed in MMKV dump | `strings` + `rg` per §1 | CLEAN |
| No seed in chrome.storage dump | `chrome.storage.local.get` + `rg` | CLEAN |
| Offscreen holds session in memory only | `handleOffscreenMessage` lock test (`vitest`) | PASS |
| Static analysis | `semgrep scan --config .semgrep/` | clean |
| Secret scan | `gitleaks detect --no-git -v` | clean |
| MV3 review | `pnpm --filter ./apps/extension review` | `ext:review ok` |
| Mobile unit | `pnpm --filter ./apps/mobile test` | PASS |
| Extension unit | `pnpm --filter ./apps/extension test` | PASS |
| Typecheck | `pnpm -w typecheck` | PASS |
| Approval queue approve/reject | `approval.test.ts` | PASS |
| Onboarding/send flows | `onboarding.test.ts`, `send.test.ts` | PASS |

> Re-run `semgrep`/`gitleaks` before every staged rollout gate (1% → 10% → 100%).
> Paste the CI job URLs for the release tag into the table above.

## Iteration 2 delta

New procedures for U030–U045 features. Re-run per staged gate (1% → 10% → 100%).

| Check | Tool / command | Result |
|---|---|---|
| No sessionId in persistent stores | `semgrep --config .semgrep --error` (`no-store-secrets`) | |
| session.memory-only after lock | offscreen `lock` → `signEth` returns `{ ok: false, error: 'locked' }` | |
| Bundle budget | `pnpm run size:check` (< 500 KB gz JS) | |
| Contrast AA | `node scripts/contrast-check.mjs` (≥ 4.5:1) | |
| Watch-only banner on all screens | manual spot-check: import watch-only → home/send/settings show banner, sign disabled | |
| Ledger blind-sign warning | manual: blind-sign tx shows blocking warning + hardware badge | |
| Infinite-allowance type-to-confirm | manual: swap approve → infinite requires typed confirm | |
| High-slippage block (>10%) | manual: 10%+ slippage quote blocked by policy-engine | |
| ed25519-bip32 vectors | `cargo test` (cardano-serialization-lib fixtures) | |
| Taproot key-path spend | `cargo test` (P2TR vectors) | |
| Extension packaging | `pnpm run ext:package` + SHA256SUMS attached | |

Manual semgrep check (if the `semgrep` binary is unavailable locally):
`rg -i 'sessionId|mnemonic|privateKey' apps/*/src --glob '!*session-store*'`
must show no writes to `localStorage`/`chrome.storage.local`/MMKV.
Fixtures: `.semgrep/fixtures/store-ok.ts` (clean) vs `store-bad.ts` (flags).
