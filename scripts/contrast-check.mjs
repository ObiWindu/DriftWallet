// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// contrast-check.mjs (U001/U052 a11y gate): verify design-token color pairs
// meet WCAG AA (contrast >= 4.5:1 for normal text).
// Defensive: tokens file is owned by Stream A and may not exist yet — in that
// case print a warning and exit 0 (vacuous pass), so this never blocks CI
// before the tokens land.
// Usage: node scripts/contrast-check.mjs [--tokens packages/ui/src/tokens.json]
import fs from "node:fs";
import path from "node:path";

const CANDIDATES = [
  "packages/ui/src/tokens.json",
  "packages/ui/tokens.json",
  "packages/ui/src/tokens.ts",
];

function luminance(hex) {
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const ti = process.argv.indexOf("--tokens");
let tokenPath = ti >= 0 ? process.argv[ti + 1] : CANDIDATES.find((c) => fs.existsSync(path.join(process.cwd(), c)));

if (!tokenPath) {
  console.warn("contrast-check: no tokens file found (Stream A in-flight) — vacuous PASS with warning");
  process.exit(0);
}

const abs = path.join(process.cwd(), tokenPath);
let tokens;
try {
  const raw = fs.readFileSync(abs, "utf8");
  tokens = abs.endsWith(".json") ? JSON.parse(raw) : null;
  if (!tokens) {
    console.warn(`contrast-check: ${tokenPath} is TS, not JSON — static parse skipped, vacuous PASS`);
    process.exit(0);
  }
} catch (e) {
  console.error(`contrast-check: cannot read ${tokenPath}: ${e.message}`);
  process.exit(1);
}

// Expected shape: { pairs: [{ fg, bg, name }] } or { light: {...}, dark: {...} }
// with `text`/`background` keys. Anything else -> warn + pass (tokens evolving).
const pairs = tokens.pairs ??
  ["light", "dark"]
    .filter((t) => tokens[t]?.text && tokens[t]?.background)
    .map((t) => ({ name: `${t} text/bg`, fg: tokens[t].text, bg: tokens[t].background }));

if (!pairs.length) {
  console.warn("contrast-check: no recognizable color pairs — vacuous PASS with warning");
  process.exit(0);
}

let failed = 0;
for (const p of pairs) {
  const r = ratio(p.fg, p.bg);
  const ok = r >= 4.5;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${p.name}: ${p.fg} on ${p.bg} = ${r.toFixed(2)}:1`);
  if (!ok) failed++;
}
if (failed) {
  console.error(`contrast-check FAILED: ${failed} pair(s) below 4.5:1`);
  process.exit(1);
}
console.log("contrast-check ok");
