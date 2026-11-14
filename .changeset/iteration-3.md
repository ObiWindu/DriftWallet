---
"@drift/gateway": minor
"@drift/gateway-client": minor
"@drift/features": minor
"@drift/policy-engine": minor
"@drift/keystore": minor
"@drift/extension": minor
"@drift/mobile": minor
---

Iteration 3 — full-fledged wallet apps:

- Gateway: real upstream surface (per-chain EVM RPC, fee tiers, ERC-20/SPL
  balances, tx status, price history, swap quotes 0x/Jupiter, NFT index, Koios
  submit, allowlisted RPC passthrough), bounded LRU caches, upstream health on
  /healthz, OpenAPI generated from the route registry.
- gateway-client: typed bigint methods + query specs for every endpoint.
- features: portfolio aggregation (allocation/P&L/sparklines, integer cents),
  watchlist + price alerts, NFT collection allow/blocklist + spam scoring,
  per-origin push revoke, send recipient resolution pipeline (ENS/SNS/handle +
  poison check + amount guard).
- policy-engine: per-session spending limits, EIP-712 domain-vs-origin check,
  dynamic phishing list, setApprovalForAll/permit detection.
- keystore: duress PIN (decoy vault + onDuressUnlock), per-session spend
  accumulator with hard cap, lockAll/wipeAll.
- extension: gateway-backed portfolio/activity/swap/recipient models,
  policy-engine-backed approval decisions (sim mismatch blocks, warn step-up,
  deny can never approve), WC session expiry + phishing proposer guard,
  watch-only guard + spend limit in settings.
- mobile: new Swap/Stake/Nfts/Security/Portfolio screen models, watch-only
  navigation gate, spend limit + duress flag in store, float constant removed.
