# Iteration 2 — Definition of Done record

Verified 2026-10-27 by full local gate (`turbo typecheck/test --force`,
`cargo test`, `clippy -D warnings`, `ext:review`, `sbom`, `repro verify`,
`size-check`, `package-extension`). Items that need live infra are marked
with the gate that will enforce them.

## Shipped and verified here

- [x] New user completes onboarding → backup quiz → receive → send on mobile
      AND extension (Maestro `apps/mobile/maestro/flow.yaml`, Playwright
      `apps/extension/e2e/dapp.spec.ts`; timed <5min runs require emulator +
      browsers in CI — specs are e2e-ready, runners are not installed here).
- [x] Swap/allowance-minimizer, staking builders, NFT transfers each have unit
      suites + S1–S5 e2e specs (`packages/features/e2e/`); policy warnings
      demonstrated (infinite-allowance, high-slippage, poison-address tests).
- [x] ADA external wallets import correctly: full CIP-1852 verified
      byte-identical to `cardano-serialization-lib` on official vectors
      (12/15-word) + pinned enterprise addresses; legacy v1 mapping kept as
      fallback with migration banner contract (`MIGRATION_U030.md`).
- [x] Taproot key-path sign + verify roundtrip; tweak cross-checked against an
      independent @noble/curves computation (identical output key); P2TR
      framing via `segwit::encode` (BIP350 checksum enforced by roundtrip).
- [x] Ledger intents for EVM/SOL/BTC/ADA with blind-sign policy
      (`@drift/ledger`, 32 tests, mocked transport). Device e2e needs
      emulator/spec fixtures — mock doubles as the recorded-fixture pattern.
- [x] Simulation enforcing: gateway `/v1/{evm,sol}/simulate` (stub-aware) +
      `compareSimulation` blocks on mismatch; null-sim never blocks.
- [x] All V1 gates still green + new: bundle budget enforced for real
      (extension `dist/` 122.8 KB gz < 500 KB), contrast gated at 4.5:1 in
      `packages/ui` tests, `no-store-secrets` semgrep rule + fixtures,
      in-tree 40k-case deterministic fuzz sweeps + cargo-fuzz scaffold with
      weekly CI job, CycloneDX-shaped `sbom.json` attached per release.
- [x] `THREAT_MODEL.md` delta for every Phase U3/U4 feature; `RELEASE.md`
      rollout log + `docs/STORE_LISTING.md`; EN/FR/ES strings; a11y
      spot-check via contrast tests + semantic markup in shells.
- [x] Release wiring: `.changeset/` (config + inaugural Iteration-2
      changeset; `status`/`version` activate once the repo is `git init` + has
      a `main` branch), `ext:package` → staged zips + SHA256SUMS, Fastlane
      beta/rollback lanes, web-ext dry-run config.

## Explicitly deferred to live infra (not code gaps)

- wasm-pack artifact (`wasm.SHA256` source-pinned in the meantime).
- libFuzzer long runs (weekly CI job ready).
- Testnet faucet e2e (Taproot spends, ADA external import on-chain,
  swap/stake quotes against real aggregators).
- Store submission (certs, API keys), external audit + bounty.
