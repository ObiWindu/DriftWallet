// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

// Settings screen view-model (U014). Auto-lock presets, biometric toggle
// state, network selection, export-seed timed visibility, wipe confirmation.
// Bounds mirror `store.ts` setAutoLockMs (30s–30min); the store enforces.

export const AUTO_LOCK_MIN_MS = 30_000;
export const AUTO_LOCK_MAX_MS = 30 * 60_000;

/** Preset auto-lock durations offered in Settings (all within store bounds). */
export function autoLockPresets(): number[] {
  return [30_000, 60_000, 300_000, 900_000, 1_800_000];
}

export type AutoLockResult = { ok: true; ms: number } | { ok: false; errorKey: "settings.autoLock" };

export function setAutoLock(ms: unknown): AutoLockResult {
  const parsed = z.number().int().safeParse(ms);
  if (!parsed.success) return { ok: false, errorKey: "settings.autoLock" };
  if (parsed.data < AUTO_LOCK_MIN_MS || parsed.data > AUTO_LOCK_MAX_MS) {
    return { ok: false, errorKey: "settings.autoLock" };
  }
  return { ok: true, ms: parsed.data };
}

/**
 * Export-seed timed visibility: the seed auto-clears `AUTO_CLEAR_MS` after
 * reveal. Epoch-millis arithmetic only (time, not money — Number is fine).
 */
export const EXPORT_AUTO_CLEAR_MS = 30_000;

export function exportVisibility(nowMs: number, revealedAtMs: number): { visible: boolean; remainingMs: number } {
  z.number().int().min(0).parse(nowMs);
  z.number().int().min(0).parse(revealedAtMs);
  const remainingMs = revealedAtMs + EXPORT_AUTO_CLEAR_MS - nowMs;
  return { visible: remainingMs > 0, remainingMs: Math.max(0, remainingMs) };
}

export function confirmWipe(input: unknown, expected = "WIPE"): {
  confirmed: boolean;
  errorKey: "settings.wipeConfirm" | null;
  hintKey: "settings.wipePlaceholder";
} {
  const text = z.string().max(64).safeParse(input);
  if (!text.success || text.data !== expected) {
    return { confirmed: false, errorKey: "settings.wipeConfirm", hintKey: "settings.wipePlaceholder" };
  }
  return { confirmed: true, errorKey: null, hintKey: "settings.wipePlaceholder" };
}

export interface NetworkOption {
  id: "mainnet" | "testnet";
  labelKey: "settings.mainnet" | "settings.testnet";
  selectable: boolean;
}

/** Mainnet is selectable only when the build enables it (SPEC DoD default off). */
export const CRASH_REPORTING_DEFAULT = false;

export function crashReportingConsent(value: unknown): boolean {
  const parsed = z.boolean().safeParse(value);
  if (!parsed.success) return CRASH_REPORTING_DEFAULT;
  return parsed.data;
}

export function networkOptions(mainnetEnabled: boolean): NetworkOption[] {
  z.boolean().parse(mainnetEnabled);
  return [
    { id: "mainnet", labelKey: "settings.mainnet", selectable: mainnetEnabled },
    { id: "testnet", labelKey: "settings.testnet", selectable: true },
  ];
}
