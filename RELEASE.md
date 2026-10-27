# DriftWallet — Release Process (T012)

## 1. Versioning (changesets)

- Every user-facing change ships with a changeset file (`.changeset/<name>.md`):
  ```md
  ---
  "@drift/mobile": patch
  "@drift/extension": patch
  ---
  Fix approval-queue double-decide error copy.
  ```
- Bump levels: `patch` (bugfix), `minor` (feature), `major` (breaking / migration).
- On `main`, the changesets bot opens a Version PR; merging it tags
  `@drift/mobile@x.y.z` / `@drift/extension@x.y.z`.
- Never hand-edit `version` fields — the Version PR owns them.

## 2. SBOM

```sh
pnpm sbom    # writes ./sbom.json (pnpm list + cargo metadata)
```

- JS side: `pnpm list --recursive --json` snapshot (see `scripts/sbom.mjs`).
- Rust/WASM side: `cargo metadata --manifest-path packages/signer/rust/Cargo.toml`
  snapshot of the `drift-signer` crate (`ffi` + `wasm_bind` surfaces included).
- Attach `sbom.json` to the GitHub release + store listing for every staged gate.
- Full CycloneDX (`cargo cyclonedx`, `pnpm sbom --format cyclonedx`) can replace
  this snapshot later — the file shape already has
  `bomFormat: CycloneDX` + `components[]`.

## 3. Reproducible WASM

```sh
pnpm repro          # records/verifies wasm.SHA256 (see scripts/repro.mjs)
```

1. Build the signer WASM deterministically (`rust-toolchain.toml` pinned, see
   `packages/signer/ts/wasm.README.md`).
2. `scripts/repro.mjs record` writes the SHA-256 of
   `packages/signer/ts/wasm-pkg/drift_signer_bg.wasm` to
   `packages/signer/ts/wasm.SHA256`. Until wasm-pack runs, the file holds a
   `PENDING-WASM <cargo-lock-sha>` line that pins the signer sources — any
   `drift-signer` change invalidates it and blocks the release gate.
3. `scripts/repro.mjs verify` recomputes the digest and fails the release on mismatch.
4. Publish the digest in the release notes; verifiers rebuild with
   `rustc --version` from `rust-toolchain.toml` and compare.

## 4. Store assets checklist

- [ ] App name, icon (1024px), feature graphic, 4+ screenshots per form factor.
- [ ] Privacy policy URL + data-safety / nutrition labels (no seed collection).
- [ ] MV3 `review` green (`pnpm --filter ./apps/extension review`).
- [ ] `PERMISSIONS.md` justification matches the submitted manifest.
- [ ] `SECURITY_TEST_EVIDENCE.md` table filled with CI links for the tag.
- [ ] `sbom.json` + `wasm.SHA256` attached to the release.

## 5. Staged rollout

| Stage | Mobile (Play / App Store) | Extension (CWS / AMO) |
|---|---|---|
| 1% | Internal + 1% production, 24h bake, crash-free ≥ 99.5% | Trusted-testers group, 24h |
| 10% | 10% production, 48h bake, re-run `SECURITY_TEST_EVIDENCE.md` scans | 10% gradual rollout (CWS %) |
| 100% | Full rollout after 10% gates green | Full publish after 10% gates green |

Halt/rollback on: new crash cluster, failed attestation spike, policy-engine
deny-bypass report, or any seed-in-storage finding. Roll back the staged track
first, then cut a `patch` changeset with the fix.

## 6. Release train (Iteration 2: U051/U054)

Lanes: Fastlane `beta` (mobile) + `web-ext sign` (extension). WASM job runs
manual-dispatch only (`workflow_dispatch`) to keep PRs fast — dispatch it
before any staged gate so `repro verify` covers the shipped signer.

```sh
# Extension: build both targets, review, zip, checksums
pnpm run ext:package   # -> drift-wallet-chrome.zip / -firefox.zip + SHA256SUMS
npx web-ext lint -s apps/extension/dist-firefox --self-hosted   # dry-run
npx web-ext sign --channel listed   # real submit (AMO creds from env, manual)

# Mobile (stubs until signing creds exist; see apps/mobile/fastlane/Fastfile):
#   fastlane android beta stage:1pct | stage:10pct | stage:100pct
#   fastlane ios     beta stage:1pct | stage:10pct | stage:100pct
#   fastlane [android|ios] rollback   # halt track first, then patch changeset
```

Staged rollout gates (each stage needs ALL green before promoting):

| Gate | Command / signal |
|---|---|
| CI green on the tag | `rust`, `ts`, `ext-package`, `perf-budget`, `a11y` jobs |
| Repro + SBOM | `pnpm run repro`, `pnpm sbom`, CycloneDX attached |
| Security evidence | `SECURITY_TEST_EVIDENCE.md` Iteration 2 table filled + CI links |
| Crash-free ≥ 99.5% | 24h bake at 1%, 48h bake at 10% |
| Attestation | no failed-attestation spike (Play Integrity / App Attest) |
| Policy | no deny-bypass report; simulation-mismatch blocks verified |

Rollback runbook: (1) halt/pause the staged track (`rollback` lane),
(2) confirm halt in store consoles, (3) cut a `patch` changeset with the fix,
(4) re-enter the train at 1%. Status page stub: link the current stage + gate
results in the release notes until a real status page exists.
