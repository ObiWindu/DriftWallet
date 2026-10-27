# Drift signer WASM (extension offscreen)

The extension offscreen document loads the Rust signer core as WASM.
`src/wasm.ts` dynamic-imports the generated glue at
`packages/signer/ts/wasm-pkg/drift_signer.js`. That directory is NOT
committed — build it locally:

```sh
# from repo root
rustup target add wasm32-unknown-unknown

cargo install wasm-pack  # once

cd packages/signer/rust
wasm-pack build --target web \
  --out-dir ../ts/wasm-pkg \
  --out-name drift_signer
```

Minimum `wasm-pack` version: 0.12. Record the exact toolchain + output hash:

```sh
wasm-pack --version > ../ts/wasm.SHA256
sha256sum ../ts/wasm-pkg/drift_signer_bg.wasm >> ../ts/wasm.SHA256
sha256sum ../ts/wasm-pkg/drift_signer.js >> ../ts/wasm.SHA256
```

Commit the updated `packages/signer/ts/wasm.SHA256` alongside any signer
change so reviewers can verify the shipped bytes. Never commit the full
`wasm-pkg/` directory.

Security notes:

- Session handles stay in memory only. Never write sessions, mnemonics, or
  passwords to `localStorage` / `sessionStorage` / IndexedDB.
- `src/wasm.ts` validates every input with `zod`
  (`isPathAllowed` / `isChainAllowed`); Rust re-validates defense-in-depth.
