# DriftWallet — Iteration 4 Plan ("dApp pipeline + integration proof")

Status: COMPLETE | Follows ITERATION3_PLAN.md (docs/ITERATION3_DOD.md)

## Delivered
- **dApp request pipeline** (`apps/extension/src/dapp-request.ts`): untrusted
  EIP-1193/WC/CIP-30 requests -> policy-engine Intent -> `decideWithPolicy`
  -> approval queue. Namespace method allowlist; phishing origin -> deny;
  unsupported method -> rejected; never signs in this module.
- **End-to-end simulation gate** (F-P0-3 closed for real): policy-engine
  `compareDeltas` (claimed deltas vs gateway simulation, fee tolerance);
  `handleDappRequest` builds claimed deltas for native transfers and maps
  mismatch -> deny, which `approveWithGate` refuses to approve.
- **Integration E2E** (`tests/e2e`, `@drift/e2e`): real gateway server +
  real gateway-client + real policy engine against in-process mock upstreams
  (EVM RPC, prices, 0x, Esplora). Full loop: health -> prices -> history ->
  balance -> fee tiers -> ERC-20 balances -> swap quote -> simulate ->
  broadcast -> tx status -> sim gate allow/block. Runs in `pnpm -w test`.
- `@drift/gateway` now exposes `main`/`exports` (like all workspace packages).

## Gates
`turbo run test typecheck` 38/38 tasks green; cargo test 19/19; ext build
104.1 KB gz / 500 KB; contrast 16/16 AA; repro/sbom/versions/openapi clean.

## Next (Iteration 5 candidates)
- Real Ledger transport behind the existing interface + recorded fixtures.
- Play Integrity / App Attest before seed export (fail closed).
- FCM/APNs push delivery for tx/alert events (local evaluation shipped).
- Playwright extension E2E + Maestro mobile E2E against the mock gateway
  in CI (infra-dependent).
- Fiat on-ramp widget, advanced fee controls (custom gas, RBF bump).
