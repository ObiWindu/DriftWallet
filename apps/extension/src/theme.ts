// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// Extension-local theme tokens + pure display helpers (U020/U022).
// Self-contained copy of the primitives the extension needs — do NOT import
// in-flight mobile work or packages/ui. Duplication with mobile is accepted
// and noted (see ITERATION2_PLAN Stream B file ownership).
import { formatBalance } from "./popup.js";

export type ThemeMode = "light" | "dark";

export interface Theme {
  mode: ThemeMode;
  bg: string;
  surface: string;
  text: string;
  muted: string;
  primary: string;
  ok: string;
  warn: string;
  bad: string;
  border: string;
}

export const lightTheme: Theme = {
  mode: "light",
  bg: "#ffffff",
  surface: "#f4f5f7",
  text: "#111214",
  muted: "#6b7280",
  primary: "#2563eb",
  ok: "#15803d",
  warn: "#b45309",
  bad: "#b91c1c",
  border: "#e5e7eb",
};

export const darkTheme: Theme = {
  mode: "dark",
  bg: "#111214",
  surface: "#1c1e21",
  text: "#f4f5f7",
  muted: "#9ca3af",
  primary: "#60a5fa",
  ok: "#4ade80",
  warn: "#fbbf24",
  bad: "#f87171",
  border: "#2e3238",
};

export function themeFor(mode: ThemeMode): Theme {
  return mode === "dark" ? darkTheme : lightTheme;
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;
export const typeScale = {
  caption: 12,
  body: 14,
  title: 16,
  headline: 20,
  display: 28,
} as const;
export const motion = { fastMs: 120, baseMs: 200, slowMs: 320 } as const;

/** Bigint-aware amount: minor units → human string (no float). */
export function formatTokenAmount(balanceMinor: string, decimals: number): string {
  return formatBalance(balanceMinor, decimals);
}

/** "0x1234…abcd" truncation; short inputs pass through unchanged. */
export function truncateAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 1) return address;
  return `${address.slice(0, chars + 2)}…${address.slice(-chars)}`;
}

const TONE_BY_VERDICT = { allow: "ok", deny: "bad", stepUp: "warn" } as const;
export type VerdictTone = (typeof TONE_BY_VERDICT)[keyof typeof TONE_BY_VERDICT];

/** Map a policy verdict to a theme tone key. */
export function toneForVerdict(verdict: "allow" | "deny" | "stepUp"): VerdictTone {
  return TONE_BY_VERDICT[verdict];
}
