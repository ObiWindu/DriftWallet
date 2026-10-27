# Security Policy

- Non-custodial: team never holds seeds. No key escrow, no recovery service.
- Report: security@drift.example — PGP on request. 90-day disclosure after fix.
- Gates (CI must pass): `cargo test`, `cargo clippy -D warnings`, `cargo deny`, `cargo audit` (no critical), `pnpm typecheck/test`, semgrep `no-secret-log`, `ext:review`, `gitleaks`.
- Secrets: never commit `.env`, vault blobs, or mnemonics. Use `.env.example` only.
- WASM hash: `packages/signer/ts/wasm.SHA256` recorded per release; reproducible build required.
- Mobile release: `allowBackup=false`, Hermes + R8, no `debuggable=true`.
- Incident: revoke gateway keys, rotate RPC endpoints, force auto-lock via push flag, publish advisory.

## No-secret-log rule
`console.log`, `Sentry.capture*`, and gateway logs MUST NOT include: mnemonic, seed, privateKey, DEK, password, raw PSBT with keys.
Semgrep rule `.semgrep/no-secret-log.yml` enforces.

## Iteration 2 delta

- Gates added in CI: `no-store-secrets` semgrep (sessionId/seed in
  localStorage/MMKV/`chrome.storage.local` blocked; `chrome.storage.session`
  is the only approved session holder), extension bundle budget
  (`size:check`, < 500 KB gz JS), contrast check (`contrast:check`, ≥ 4.5:1).
- dApp surfaces (WalletConnect v2, EIP-6963, CIP-30, Solana wallet-standard)
  are hostile input: zod-validate, assert origin, simulation-enforced approve.
- Ledger: blind-sign requires explicit user acknowledge; infinite allowance via
  hardware blocked.
- Swaps: exact-amount allowance default; infinite needs type-to-confirm.
- Watch-only: persistent "view only" banner on every screen; no sign path.
- ed25519-bip32 (CIP-1852) + Taproot send landed in the signer; WASM digest
  re-recorded per release. V1 ADA fallback derivation retained.
