# DriftWallet — Iteration 3 Plan ("Full-Fledged Wallet")

Status: COMPLETE — see docs/ITERATION3_DOD.md | Branch: main | Follows ITERATION2_PLAN.md (complete, see docs/ITERATION2_DOD.md)

Goal: turn the verified V1/Iteration-2 foundation into a feature-rich, secure,
production-ready wallet app set (extension + mobile + gateway). Every iteration
ends with `turbo run test typecheck` green and new tests for new behavior.

## Iteration A — Gateway becomes a real production service
- Bounded LRU caches for every cache (balances, prices, history, tokens, nfts).
- New endpoints, all Zod-validated, all with a `stub` flag and live upstreams
  behind env config (empty-string-safe detection):
  - `GET /v1/evm/:chainId/fee-estimate` — gas estimate + low/med/high fee tiers
    (`eth_estimateGas`, `eth_feeHistory`/`eth_gasPrice`).
  - `GET /v1/evm/:chainId/tokens/:addr` — ERC-20 balances via `eth_call`
    (`balanceOf`) for the chain token allowlist + arbitrary `?tokens=`.
  - `GET /v1/sol/tokens/:addr` — SPL token accounts (`getTokenAccountsByOwner`)
    + mint decimals.
  - `GET /v1/evm/:chainId/tx/:hash` — receipt status for the activity feed.
  - `GET /v1/sol/tx/:sig` — signature statuses.
  - `GET /v1/prices/history?assets=&span=` — sparkline series, cached.
  - `POST /v1/swap/quote` — 0x (EVM) / Jupiter (Solana) quote proxy with
    price-impact computation server-side.
  - `GET /v1/nfts/:chain/:addr` — NFT index via configured provider.
  - `POST /v1/ada/broadcast` — real Koios submit.
  - Per-chain EVM RPC override: `EVM_RPC_URL_<CHAIN_ID>` falls back to `EVM_RPC_URL`.
  - `/healthz` reports version + per-upstream reachability.
- Tests: in-process mock upstream HTTP server; assert live vs stub flags,
  caching, validation errors, rate limiting.
- `packages/gateway-client`: typed methods + query specs for all new endpoints.

## Iteration B — Feature layer (packages/features)
- `portfolio.ts` — cross-chain aggregation: balances + prices -> total fiat in
  integer cents, allocation %, 24h change, sparkline downsampling, optional
  cost-basis P&L, stale-price indicator. Bigint-only money.
- `price-alerts.ts` — watchlist + price alert rules evaluated locally
  (above/below/percent-change), no PII leaves the device.
- `nfts.ts` — collection allowlist/blocklist + spam scoring (airdrop filter).
- `notifications.ts` — tx status + security events with per-origin one-tap revoke.
- `send-flow.ts` — recipient resolution pipeline: ENS/SNS/ADA-handle ->
  address -> poison check -> review model.

## Iteration C — Security enforcement
- `policy-engine`: per-session spending limits (bigint), step-up requirement
  above a fiat threshold, EIP-712 domain-vs-origin match, dynamic phishing
  list (injected from gateway), permit/permit2 infinite-allowance detection.
- `keystore`: duress PIN (second vault, flagged session, panic `wipeAll()`),
  per-session spend accumulator with hard cap, explicit `lockAll()`.
- Extension approval flow: simulation mismatch blocks signing; high-value
  requires step-up (WebAuthn gate already stubbed — wire it).

## Iteration D — Extension app wiring
- Popup/full-page models backed by gateway-client: portfolio, activity,
  swap review, settings (origins, spending limit, auto-lock, watch-only).
- WalletConnect: session expiry, `session_delete`, namespace/chain checks,
  phishing origin rejection.

## Iteration E — Mobile app wiring
- Fix F-P1-1: remove legacy float money from `apps/mobile/src/send.ts`.
- New screen view-models: portfolio, swap, stake, NFT gallery, security
  settings (auto-lock, duress, spending limits, phishing, revoke sessions).
- Watch-only banner mechanically enforced + tested on every screen model.

## Iteration F — Production readiness
- Real contrast gate: tokens emitted as JSON, `contrast-check.mjs` fails CI < 4.5:1.
- OpenAPI generated from route schemas; CI diff check.
- CI: gateway tests, size check, contrast, semgrep (docker), changesets release flow.
- Docs: `docs/ITERATION3_DOD.md`, THREAT_MODEL.md deltas, README refresh, changesets.

## Non-goals (unchanged)
- No custody, no key escrow, no in-house swap execution (quotes only),
  no AA/social recovery this iteration, no Ordinals minting.
