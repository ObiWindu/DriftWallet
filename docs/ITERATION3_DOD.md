# Iteration 3 — Definition of Done record

Status: COMPLETE | All workspace gates green: `turbo run test typecheck` 35/35,
`cargo test` 19/19, `ext:build` + `size:check` (104.1 KB gz / 500 KB budget),
`ext:review` ok, `contrast-check` 16/16 pairs >= 4.5:1, `repro verify` ok,
`sbom` ok, `check-versions` ok, OpenAPI snapshot regenerated and CI-diffed.

## Delivered

| Area | Evidence |
|---|---|
| Gateway live surface | `services/gateway/src/index.ts` — per-chain `EVM_RPC_URL_<id>`, fee-estimate, ERC-20/SPL balances, tx status (EVM/SOL), price history, swap quote (0x/Jupiter), NFT index, Koios submit, allowlisted `/rpc` passthrough, bounded LRU cache, upstream health on `/healthz`; 20 tests incl. in-process mock upstreams |
| OpenAPI generated | `/openapi.json` rendered from the route registry; `scripts/dump-openapi.mts` snapshot regenerated; CI `git diff --exit-code` gate holds |
| gateway-client | 23 typed methods (bigint money), query specs for all reads; 11 tests |
| Features | `portfolio.ts` (aggregate/allocation/P&L/sparkline, integer cents), `price-alerts.ts` (watchlist + above/below/pctMove), `send-flow.ts` (name resolution + poison + amount guard), NFT collection filter + spam score, revoke list + security events; 46 tests |
| Policy engine | spending limits (block > limit, warn >= 80%), EIP-712 domain match, dynamic phish list, setApprovalForAll/permit max detection; 15 tests |
| Keystore | duress PIN (decoy vault, `onDuressUnlock`), spend accumulator (`SPEND_LIMIT_EXCEEDED`), `lockAll`/`wipeAll`; 13 tests |
| Extension | `gateway-models.ts` (portfolio/activity/swap/recipient), `decideWithPolicy` (sim mismatch -> deny, warn -> stepUp, deny unapprovable), WC expiry/prune/phish guard/chain coverage, watch-only settings guard; 80 tests |
| Mobile | Swap/Stake/Nfts/Security/Portfolio screens, `watchonly.ts` chrome guard, sign-route navigation gate, store watchOnly + spendLimit; 61 tests |
| Entry points | `main`/`exports` added to all workspace packages so apps import `@drift/*` cleanly |

## Findings resolved from IMPROVEMENT_PLAN.md
- F-P0-2 env truthiness — regression test in gateway (`empty-string env is stub`).
- F-P0-3 simulation blocks — `decideWithPolicy` maps SIM_MISMATCH to deny; deny cannot be approved even with gate.
- F-P0-9 gateway stub-only — live proxies with `stub` flags + tests.
- F-P0-10 rate limiter unbounded — LRU buckets; cache also bounded (test: cacheSize <= max).
- F-P1-1 float money — mobile send path already bigint; stale float constant removed from store.
- F-P1-4 OpenAPI hand-maintained — now generated from route registry.
- F-P1-10 watch-only banner — shell banner + `screenChrome` guard on every new screen model + sign-route nav gate, all tested.
- F-P2-2 address book trust metadata — already present; extended by send-flow pipeline.
- F-P2-4 NFT spam — collection allow/blocklist + reveal + score.
- F-P2-5 revoke UX — RevokeList + gateway `/v1/push/revoke` client method.

## Still open (Iteration 4+)
- Native mobile shells build on real devices (UniFFI bindings are contract-level here).
- Real Ledger transport (mocks only), Play Integrity/App Attest before seed export.
- E2E runners (Playwright/Maestro) against mock gateway in CI.
- Price alerts delivery via FCM/APNs (local evaluation shipped; push plumbing open).
