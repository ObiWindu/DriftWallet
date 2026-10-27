// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// sbom generator stub (T012): snapshots JS (+ Rust when present) into sbom.json.
// Offline-safe: shells out to `pnpm list` / `cargo metadata`; on failure it
// records `not-present` instead of throwing so `pnpm sbom` stays green pre-crates.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "sbom.json");

function tryJson(cmd) {
  try {
    return JSON.parse(execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  } catch {
    return null;
  }
}

function jsComponents() {
  const data = tryJson("pnpm list --recursive --json");
  if (!data) return [{ name: "js", note: "pnpm list unavailable (offline?) — stub" }];
  const pkgs = Array.isArray(data) ? data : [data];
  const out = [];
  for (const p of pkgs) {
    const deps = { ...(p.dependencies ?? {}), ...(p.devDependencies ?? {}) };
    for (const [name, info] of Object.entries(deps)) {
      out.push({ name, version: info?.version ?? "unknown", scope: p.name ?? "root" });
    }
  }
  return out.length > 0 ? out : [{ name: "js", note: "no deps resolved — stub" }];
}

function rustComponents() {
  const meta = tryJson("cargo metadata --manifest-path packages/signer/rust/Cargo.toml --format-version 1 --no-deps");
  if (!meta) return { status: "not-present", note: "cargo metadata failed" };
  const pkgs = (meta.packages ?? []).map((p) => ({ name: p.name, version: p.version }));
  return { status: "present", packages: pkgs };
}

const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  generatedAt: new Date().toISOString(),
  root: "driftwallet",
  components: {
    js: jsComponents(),
    rust: rustComponents(),
  },
  note: "Stub SBOM. Replace with `pnpm sbom --format cyclonedx` + `cargo cyclonedx` once signer crate lands.",
};

fs.writeFileSync(OUT, JSON.stringify(sbom, null, 2) + "\n");
console.log(`sbom ok -> ${OUT}`);
