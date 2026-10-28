// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// contrast-check.mjs (U001/U052 a11y gate): verify design-token color pairs
// meet WCAG AA (contrast >= 4.5:1 for normal text).
//
// The canonical tokens live in packages/ui/src/tokens.ts. This script parses
// that TS module statically (no JSON artifact, no transpiler) so the gate is
// enforceable in CI without a build step. A missing/unparseable tokens file
// or any pair below 4.5:1 exits non-zero.

import fs from "node:fs";
import path from "node:path";

const TOKENS_PATH = "packages/ui/src/tokens.ts";

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

const abs = path.join(process.cwd(), TOKENS_PATH);
if (!fs.existsSync(abs)) {
  console.error(`contrast-check FAILED: tokens file missing: ${TOKENS_PATH}`);
  process.exit(1);
}
const src = fs.readFileSync(abs, "utf8");

function parsePalette(name) {
  const re = new RegExp(`export const ${name}: Palette = \\{([\\s\\S]*?)\\};`, "m");
  const m = src.match(re);
  if (!m) throw new Error(`palette ${name} not found`);
  const body = m[1];
  const out = {};
  const kv = /(\w+)\s*:\s*"(#[0-9a-fA-F]{6})"/g;
  let mm;
  while ((mm = kv.exec(body)) !== null) out[mm[1]] = mm[2];
  if (Object.keys(out).length === 0) throw new Error(`palette ${name} empty`);
  return out;
}

let light, dark;
try {
  light = parsePalette("light");
  dark = parsePalette("dark");
} catch (e) {
  console.error(`contrast-check FAILED: ${e.message}`);
  process.exit(1);
}
const themes = { light, dark };

const PAIR_DEFS = [
  { theme: "light", fg: "text", bg: "background" },
  { theme: "light", fg: "text", bg: "surface" },
  { theme: "light", fg: "textMuted", bg: "background" },
  { theme: "light", fg: "textMuted", bg: "surface" },
  { theme: "light", fg: "primary", bg: "background" },
  { theme: "light", fg: "danger", bg: "background" },
  { theme: "light", fg: "warning", bg: "background" },
  { theme: "light", fg: "success", bg: "background" },
  { theme: "dark", fg: "text", bg: "background" },
  { theme: "dark", fg: "text", bg: "surface" },
  { theme: "dark", fg: "textMuted", bg: "background" },
  { theme: "dark", fg: "textMuted", bg: "surface" },
  { theme: "dark", fg: "primary", bg: "background" },
  { theme: "dark", fg: "danger", bg: "background" },
  { theme: "dark", fg: "warning", bg: "background" },
  { theme: "dark", fg: "success", bg: "background" },
];

let failed = 0;
for (const p of PAIR_DEFS) {
  const fg = themes[p.theme][p.fg];
  const bg = themes[p.theme][p.bg];
  if (!fg || !bg) {
    console.error(`contrast-check FAILED: missing color ${p.theme}.${p.fg}/${p.bg}`);
    process.exit(1);
  }
  const r = ratio(fg, bg);
  const ok = r >= 4.5;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${p.theme} ${p.fg} on ${p.bg}: ${fg} on ${bg} = ${r.toFixed(2)}:1`);
  if (!ok) failed++;
}
if (failed) {
  console.error(`contrast-check FAILED: ${failed} pair(s) below 4.5:1`);
  process.exit(1);
}
console.log("contrast-check ok");