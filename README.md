# DriftWallet

Self-custody wallet (EVM x5 + Solana + Cardano + Bitcoin) — Android/iOS/Chrome/Firefox.
Security-first: audited Rust signer core holds all key material; TypeScript layers only ever see opaque session handles, never seeds.

## Quickstart

```sh
pnpm install
cargo test --manifest-path packages/signer/rust/Cargo.toml
pnpm -w typecheck && pnpm -w test
```

## Docs

- `SPEC.md` — locked tech stack, chain support, security design (start here)
- `ITERATION2_PLAN.md` / `docs/ITERATION2_DOD.md` — iteration 2 scope + completion record
- `THREAT_MODEL.md`, `SECURITY.md`, `SECURITY_TEST_EVIDENCE.md` — audit entry points
- `RELEASE.md`, `docs/STORE_LISTING.md` — release train, rollout gates
- `packages/signer/rust/MIGRATION_U030.md` — CIP-1852 / Taproot migration notes
- `services/gateway/openapi.json` — gateway API snapshot

## Security

Non-custodial: the team never holds seeds. See `SECURITY.md` to report issues.
No secrets are ever committed — see `.gitignore` (vaults, keystores, `.env`,
key material, crash dumps and session artifacts are all excluded) and the
`no-secret-log` semgrep rule (`.semgrep/`).

## License

Apache-2.0 — see `LICENSE`. Every source file carries an
`SPDX-License-Identifier: Apache-2.0` header.
