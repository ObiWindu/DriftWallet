// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// size-check.mjs (U052): extension popup bundle budget < 500 KB gzipped JS.
// Mobile bundle: informational note only (Hermes bytecode; no local bundle yet).
// Offline-safe, no deps. Exit 1 on budget breach, 0 otherwise.
// Usage: node scripts/size-check.mjs [--dir apps/extension/dist]
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const BUDGET_GZ_JS = 500 * 1024; // 500 KB

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const dirArg = process.argv.indexOf("--dir");
const dir = path.join(process.cwd(), dirArg >= 0 ? process.argv[dirArg + 1] : "apps/extension/dist");

if (!fs.existsSync(dir)) {
  console.warn(`size-check: ${dir} absent (extension not built) — SKIP with warning, not a pass`);
  process.exit(0);
}

let totalGz = 0;
const rows = [];
for (const f of walk(dir)) {
  if (!f.endsWith(".js")) continue;
  const raw = fs.readFileSync(f);
  const gz = zlib.gzipSync(raw).length;
  totalGz += gz;
  rows.push({ f: path.relative(dir, f), raw: raw.length, gz });
}
rows.sort((a, b) => b.gz - a.gz);
for (const r of rows.slice(0, 20)) {
  console.log(`  ${(r.gz / 1024).toFixed(1).padStart(8)} KB gz  ${(r.raw / 1024).toFixed(1).padStart(8)} KB raw  ${r.f}`);
}
console.log(`size-check: JS total ${(totalGz / 1024).toFixed(1)} KB gz (budget ${(BUDGET_GZ_JS / 1024).toFixed(0)} KB)`);

if (totalGz > BUDGET_GZ_JS) {
  console.error(`size-check FAILED: ${(totalGz - BUDGET_GZ_JS) / 1024} KB over budget`);
  process.exit(1);
}

// Mobile note: Hermes bytecode size tracked at release time via fastlane lane
// output (see apps/mobile/fastlane/Fastfile `beta` lane); no local gate yet.
console.log("size-check: mobile Hermes bundle — no local gate (see Fastfile note)");
console.log("size-check ok");
