// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// copy-wasm.mjs: stage the built signer WASM (packages/signer/ts/wasm-pkg,
// gitignored — produced by wasm-pack, see packages/signer/ts/wasm.README.md)
// into apps/extension/dist/wasm-pkg so the offscreen document can load
// ../wasm-pkg/drift_signer.js at runtime. Warns (does not fail) when the
// artifact has not been built locally; package-extension.mjs fails closed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Repo root = apps/extension/scripts -> up 3. Works regardless of cwd.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const EXT = path.join(ROOT, "apps", "extension");
const SRC = path.join(ROOT, "packages", "signer", "ts", "wasm-pkg");
const DEST = path.join(EXT, "dist", "wasm-pkg");

if (!fs.existsSync(path.join(SRC, "drift_signer.js"))) {
  console.warn(
    "copy-wasm: packages/signer/ts/wasm-pkg not built — run wasm-pack first " +
      "(see packages/signer/ts/wasm.README.md). Offscreen signer will 404 at runtime.",
  );
  process.exit(0);
}
fs.rmSync(DEST, { recursive: true, force: true });
fs.cpSync(SRC, DEST, { recursive: true });
console.log(`copy-wasm: staged ${path.relative(ROOT, SRC)} -> ${path.relative(ROOT, DEST)}`);
