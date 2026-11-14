---
"@drift/policy-engine": minor
"@drift/extension": minor
"@drift/gateway": minor
---

Iteration 4 — dApp pipeline + integration proof:

- Extension: `dapp-request.ts` routes untrusted dApp JSON-RPC (EIP-1193/WC)
  through the policy engine into the approval queue; namespace method
  allowlist, phishing -> deny, unsupported method -> rejected, never signs
  in the router.
- Policy engine: `compareDeltas` — claimed balance deltas vs gateway
  simulation with fee tolerance; mismatch blocks signing end-to-end
  (F-P0-3 closed), wired into `evaluate` via `claimedDeltas`.
- New `@drift/e2e` package: full wallet loop (health, prices, history,
  balance, fee tiers, ERC-20 balances, swap quote, simulate, broadcast, tx
  status, sim gate) against in-process mock upstreams; runs in CI via
  `pnpm -w test`.
