// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// check-versions.mjs: release-consistency gate — root + mobile + extension
// versions must match (store submissions are cut from one tag).
// Usage: node scripts/check-versions.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const files = ["package.json", "apps/mobile/package.json", "apps/extension/package.json"];
const versions = new Map();

for (const f of files) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) {
    console.error(`check-versions: missing ${f}`);
    process.exit(1);
  }
  const { version, name } = JSON.parse(fs.readFileSync(p, "utf8"));
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? "")) {
    console.error(`check-versions: bad semver in ${f}: ${version}`);
    process.exit(1);
  }
  versions.set(f, `${name}@${version}`);
}

const uniq = new Set([...versions.values()].map((s) => String(s.split("@").pop())));
if (uniq.size !== 1) {
  console.error("check-versions: version mismatch:");
  for (const [f, v] of versions) console.error(`  ${f}: ${v}`);
  process.exit(1);
}

// Locked dependency versions (React 18 per SPEC).
const reactLocked = /^18\./;
for (const f of ["apps/mobile/package.json", "apps/extension/package.json"]) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
  const react = (pkg.dependencies?.react ?? pkg.devDependencies?.react ?? "").replace(/[\^~]/g, "");
  const reactDom = (pkg.dependencies?.["react-dom"] ?? pkg.devDependencies?.["react-dom"] ?? "").replace(/[\^~]/g, "");
  const typesReact = (pkg.devDependencies?.["@types/react"] ?? "").replace(/[\^~]/g, "");
  if (react && !reactLocked.test(react)) {
    console.error(`check-versions: React version drift in ${f}: ${react} (expected 18.x)`);
    process.exit(1);
  }
  if (reactDom && !reactLocked.test(reactDom)) {
    console.error(`check-versions: React DOM version drift in ${f}: ${reactDom} (expected 18.x)`);
    process.exit(1);
  }
  if (typesReact && !reactLocked.test(typesReact)) {
    console.error(`check-versions: @types/react version drift in ${f}: ${typesReact} (expected 18.x)`);
    process.exit(1);
  }
}

console.log(`check-versions ok (${[...uniq][0]})`);
for (const [f, v] of versions) console.log(`  ${f}: ${v}`);
