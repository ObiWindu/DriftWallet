// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// package-extension.mjs (U051/U054): build extension for Chrome + Firefox,
// review the unpacked output, zip each target, write SHA256SUMS.
// Offline-safe: shells out to the extension's own vite build + review steps.
// Usage: node scripts/package-extension.mjs [--skip-build]
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const EXT = path.join(ROOT, "apps/extension");
const TARGETS = [
  { name: "chrome", outDir: "dist-chrome", manifest: "manifest.chrome.json" },
  { name: "firefox", outDir: "dist-firefox", manifest: "manifest.firefox.json" },
];

function run(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

function sha256File(p) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(p));
  return h.digest("hex");
}

const skipBuild = process.argv.includes("--skip-build");

if (!fs.existsSync(path.join(EXT, "package.json"))) {
  console.error("package-extension: apps/extension/package.json not found");
  process.exit(1);
}

for (const t of TARGETS) {
  const out = path.join(EXT, t.outDir);
  if (!skipBuild) {
    // Both manifests build from the same vite config; the per-target manifest
    // file is copied in as manifest.json after build (see apps/extension build notes).
    run("pnpm", ["--filter", "@drift/extension", "build"], ROOT);
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    const dist = path.join(EXT, "dist");
    if (!fs.existsSync(dist)) {
      console.error(`package-extension: expected build output at apps/extension/dist`);
      process.exit(1);
    }
    fs.cpSync(dist, out, { recursive: true });
    fs.copyFileSync(path.join(EXT, t.manifest), path.join(out, "manifest.json"));
    console.log(`package-extension: staged ${t.name} -> ${t.outDir}`);
  }
  if (!fs.existsSync(out)) {
    console.error(`package-extension: missing ${t.outDir} (build first, or pass --skip-build only when staged)`);
    process.exit(1);
  }
}

// Review gate (MV3 checks owned by apps/extension): fail closed.
try {
  run("pnpm", ["--filter", "@drift/extension", "review"], ROOT);
} catch {
  console.error("package-extension: ext review FAILED — refusing to zip");
  process.exit(1);
}

// Zip each target (use system zip; no npm dep, offline-safe).
const sums = [];
for (const t of TARGETS) {
  const zip = path.join(EXT, `drift-wallet-${t.name}.zip`);
  fs.rmSync(zip, { force: true });
  try {
    execFileSync("zip", ["-qr", zip, "."], { cwd: path.join(EXT, t.outDir), stdio: "inherit" });
  } catch {
    console.error("package-extension: `zip` binary missing or failed — install zip and retry");
    process.exit(1);
  }
  const sum = sha256File(zip);
  sums.push(`${sum}  drift-wallet-${t.name}.zip`);
  console.log(`package-extension: ${path.basename(zip)} ${sum}`);
}

fs.writeFileSync(path.join(EXT, "SHA256SUMS"), sums.join("\n") + "\n");
console.log("package-extension ok -> apps/extension/SHA256SUMS");
