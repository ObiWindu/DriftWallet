// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

// ---------------------------------------------------------------------------
// Device pairing model: which physical device the user paired, plus per-chain
// app version checks ("Ethereum app >= 1.9.0" etc.).
// ---------------------------------------------------------------------------

export const LedgerChain = z.enum(["evm", "solana", "bitcoin", "cardano"]);
export type LedgerChain = z.infer<typeof LedgerChain>;

export const PairedDevice = z.object({
  deviceId: z.string().min(1).max(128),
  label: z.string().min(1).max(64),
  pairedAt: z.string().datetime(),
  /** Last-known app versions per chain, e.g. { evm: "1.9.19" }. */
  appVersions: z.record(LedgerChain, z.string().regex(/^\d+\.\d+\.\d+$/)).default({}),
});
export type PairedDevice = z.infer<typeof PairedDevice>;

export const MIN_APP_VERSIONS: Record<LedgerChain, string> = {
  evm: "1.9.0",
  solana: "1.0.0",
  bitcoin: "2.0.0",
  cardano: "5.0.0",
};

const PairInput = z.object({
  deviceId: z.string().min(1).max(128),
  label: z.string().min(1).max(64),
  appVersions: z.record(LedgerChain, z.string().regex(/^\d+\.\d+\.\d+$/)).default({}),
});
export type PairInput = z.input<typeof PairInput>;

export function pairDevice(input: PairInput): PairedDevice {
  const p = PairInput.parse(input);
  return PairedDevice.parse({
    deviceId: p.deviceId,
    label: p.label,
    pairedAt: new Date().toISOString(),
    appVersions: p.appVersions,
  });
}

function parseSemver(v: string): [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error(`bad version ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Compare semver: -1 | 0 | 1. */
export function compareVersions(a: string, b: string): number {
  const [a1, a2, a3] = parseSemver(a);
  const [b1, b2, b3] = parseSemver(b);
  if (a1 !== b1) return a1 < b1 ? -1 : 1;
  if (a2 !== b2) return a2 < b2 ? -1 : 1;
  if (a3 !== b3) return a3 < b3 ? -1 : 1;
  return 0;
}

export const AppCheck = z.object({
  ok: z.boolean(),
  chain: LedgerChain,
  installed: z.string().regex(/^\d+\.\d+\.\d+$/).nullable(),
  minimum: z.string().regex(/^\d+\.\d+\.\d+$/),
  message: z.string(),
});
export type AppCheck = z.infer<typeof AppCheck>;

/** Verify the installed app version for a chain meets the minimum. */
export function checkAppVersion(
  device: PairedDevice,
  chain: LedgerChain,
  installedVersion?: string,
): AppCheck {
  const d = PairedDevice.parse(device);
  const c = LedgerChain.parse(chain);
  const minimum = MIN_APP_VERSIONS[c];
  if (minimum === undefined) throw new Error(`unknown chain ${String(c)}`);
  const installed = installedVersion ?? d.appVersions[c] ?? null;
  if (installed !== null) z.string().regex(/^\d+\.\d+\.\d+$/).parse(installed);
  if (installed === null || installed === undefined) {
    return { ok: false, chain: c, installed: null, minimum, message: `${c} app not installed` };
  }
  const ok = compareVersions(installed, minimum) >= 0;
  return {
    ok,
    chain: c,
    installed,
    minimum,
    message: ok ? `${c} app ${installed} ok` : `${c} app ${installed} too old (need >= ${minimum})`,
  };
}

/** Record (or refresh) a known-good app version after a successful device query. */
export function recordAppVersion(device: PairedDevice, chain: LedgerChain, version: string): PairedDevice {
  const d = PairedDevice.parse(device);
  const c = LedgerChain.parse(chain);
  z.string().regex(/^\d+\.\d+\.\d+$/).parse(version);
  return PairedDevice.parse({ ...d, appVersions: { ...d.appVersions, [c]: version } });
}
