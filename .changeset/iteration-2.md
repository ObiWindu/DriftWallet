---
"@drift/mobile": minor
"@drift/extension": minor
"@drift/signer-ts": patch
"@drift/keystore": patch
"@drift/policy-engine": minor
"@drift/gateway": minor
"@drift/gateway-client": minor
"@drift/chains-evm": patch
"@drift/chains-solana": patch
"@drift/chains-bitcoin": minor
"@drift/chains-cardano": minor
"@drift/core": patch
"@drift/ui": minor
"@drift/ledger": minor
"@drift/features": minor
---

Iteration 2: full CIP-1852 ed25519-bip32 (verified against
cardano-serialization-lib), Taproot key-path signing, Ledger intents,
enforcing transaction simulation, design system + mobile/extension app shells,
swaps/staking/NFTs/accounts/notifications models, WalletConnect v2 + EIP-6963
+ CIP-30 connectors, fuzz coverage, and the extension packaging pipeline.
See ITERATION2_PLAN.md and MIGRATION_U030.md (v1 ADA address encoding changed:
bech32 double-conversion fixed; v1 vaults keep the legacy mapping).
