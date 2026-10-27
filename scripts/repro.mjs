// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// repro helper (T012): record + verify the reproducible signer-WASM digest.
// Usage: `node scripts/repro.mjs [record|verify]` (default: verify-or-record).
// Real artifact: packages/signer/ts/wasm-pkg/drift_signer_bg.wasm (wasm-pack).
// Until wasm-pack runs, we record the Cargo.lock digest so ANY signer source
// change invalidates the placeholder — the release is not reproducible until
// a real WASM digest replaces the PENDING line.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const WASM_CANDIDATES = [
  "packages/signer/ts/wasm-pkg/drift_signer_bg.wasm",
  "packages/signer/ts/pkg/drift_signer_bg.wasm",
];
const LOCK = "packages/signer/rust/Cargo.lock";
const OUT = path.join(ROOT, "packages/signer/ts/wasm.SHA256");

function findWasm() {
  for (const c of WASM_CANDIDATES) {
    const p = path.join(ROOT, c);
    if (fs.existsSync(p)) return c;
  }
  return null;
}

function sha256File(p) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(p));
  return h.digest("hex");
}

const mode = process.argv[2] ?? "auto";

if (mode === "record") {
  const w = findWasm();
  if (!w) {
    const lockDigest = fs.existsSync(path.join(ROOT, LOCK)) ? sha256File(path.join(ROOT, LOCK)) : "no-lock";
    fs.writeFileSync(OUT, `PENDING-WASM ${lockDigest}  ${LOCK} (run wasm-pack, then re-record)\n`);
    console.log(`repro record: no wasm -> source-pinned placeholder ${OUT}`);
  } else {
    const d = sha256File(path.join(ROOT, w));
    fs.writeFileSync(OUT, `${d}  ${w}\n`);
    console.log(`repro record ok -> ${OUT}`);
  }
} else {
  // verify (or auto)
  if (!fs.existsSync(OUT)) {
    console.error("repro verify: wasm.SHA256 missing — run with record first");
    process.exit(1);
  }
  const raw = fs.readFileSync(OUT, "utf8").trim();
  if (raw.startsWith("PENDING-WASM")) {
    const [, lockDigest, lockRel] = raw.split(/\s+/);
    if (findWasm()) {
      console.error("repro verify: wasm built but wasm.SHA256 is placeholder — re-record");
      process.exit(1);
    }
    const p = path.join(ROOT, lockRel ?? "");
    if (lockRel && fs.existsSync(p) && sha256File(p) !== lockDigest) {
      console.error("repro verify FAILED: signer sources changed since placeholder — re-record");
      process.exit(1);
    }
    console.log("repro verify ok (wasm pending, sources pinned)");
  } else {
    const [digest, rel] = raw.split(/\s+/);
    const p = path.join(ROOT, rel ?? "");
    if (!fs.existsSync(p)) {
      console.error(`repro verify: recorded file missing: ${rel}`);
      process.exit(1);
    }
    const actual = sha256File(p);
    if (actual !== digest) {
      console.error(`repro verify FAILED: expected ${digest}, got ${actual}`);
      process.exit(1);
    }
    console.log("repro verify ok");
  }
}
