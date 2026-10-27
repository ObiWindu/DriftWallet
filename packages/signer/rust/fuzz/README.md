# Fuzzing (U053)

Two layers:

1. **In-tree deterministic sweeps** (run on stable CI today, no nightly):
   - `derive::cip1852_tests::fuzz_paths_never_panic_and_allowlist_is_exact`
     (20k structured + garbage derivation paths; allowlist exactness)
   - `bitcoin::fee_tests::fee_policy_sweep` (20k fee-policy property checks)
   - `bech32_official_vectors` (BIP173/BIP350 official strings)
   Run: `cargo test -p drift-signer`

2. **libFuzzer targets** (nightly CI, `cargo fuzz`):
   - `fuzz_targets/json_abi.rs` — the JSON-string WASM/FFI ABI surface
     (`validate_mnemonic`, `derive_pubkey`, `sign_*`, vault entry points).
     Arbitrary bytes must never panic; heavy Argon2 paths need well-formed
     vault JSON (provide seeds in `fuzz/corpus/json_abi/`).

```sh
rustup install nightly
cargo install cargo-fuzz
cd packages/signer/rust/fuzz
cargo fuzz run json_abi -- -max_total_time=300
```

Corpus: check new crashers into `fuzz/corpus/json_abi/` (never seeds with
real key material — JSON shapes only). Minimise with `cargo fuzz tmin`.
CI runs the weekly `fuzz` workflow (`.github/workflows/fuzz.yml`).
