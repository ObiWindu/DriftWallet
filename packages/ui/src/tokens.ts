// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// Design tokens (U001). Single source of truth for color, type, spacing,
// radius and motion across mobile + extension shells.
// All text/background pairs below MUST hold >= 4.5:1 contrast — enforced by
// `contrast.test.ts` (Stream E owns the repo-wide script; the package-level
// test here is the gate for this package).

export interface Palette {
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  primary: string;
  danger: string;
  warning: string;
  success: string;
  border: string;
}

export const light: Palette = {
  background: "#FFFFFF",
  surface: "#F4F5F7",
  text: "#111418",
  textMuted: "#4A5568",
  primary: "#1449B8",
  danger: "#B42323",
  warning: "#7A5200",
  success: "#0E7A3D",
  border: "#D9DEE5",
};

export const dark: Palette = {
  background: "#0B0E14",
  surface: "#161B26",
  text: "#F2F5F9",
  textMuted: "#A7B1C2",
  primary: "#8FB0FF",
  danger: "#F28B8B",
  warning: "#E8B93E",
  success: "#3ECF8E",
  border: "#2A3342",
};

export type ThemeName = "light" | "dark";
export const themes: Record<ThemeName, Palette> = { light, dark };

export const typeScale = {
  caption: { size: 12, lineHeight: 16 },
  body: { size: 14, lineHeight: 20 },
  title: { size: 18, lineHeight: 24 },
  display: { size: 28, lineHeight: 34 },
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { sm: 4, md: 8, lg: 12, pill: 999 } as const;
export const motion = { fastMs: 150, baseMs: 250, slowMs: 400 } as const;

/** Copy auto-clear delay for AddressRow (clipboard holds the address briefly). */
export const COPY_CLEAR_MS = 10_000;

function channel(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`bad hex color ${hex}`);
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

/** Relative luminance per WCAG 2.1. */
export function luminance(hex: string): number {
  const [r, g, b] = channel(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
}

/** WCAG contrast ratio in [1, 21]. */
export function contrastRatio(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export interface ContrastPair {
  theme: ThemeName;
  fg: string;
  bg: string;
  ratio: number;
}

const PAIR_DEFS: Array<{ theme: ThemeName; fgKey: keyof Palette; bgKey: keyof Palette }> = [
  { theme: "light", fgKey: "text", bgKey: "background" },
  { theme: "light", fgKey: "text", bgKey: "surface" },
  { theme: "light", fgKey: "textMuted", bgKey: "background" },
  { theme: "light", fgKey: "textMuted", bgKey: "surface" },
  { theme: "light", fgKey: "primary", bgKey: "background" },
  { theme: "light", fgKey: "danger", bgKey: "background" },
  { theme: "light", fgKey: "warning", bgKey: "background" },
  { theme: "light", fgKey: "success", bgKey: "background" },
  { theme: "dark", fgKey: "text", bgKey: "background" },
  { theme: "dark", fgKey: "text", bgKey: "surface" },
  { theme: "dark", fgKey: "textMuted", bgKey: "background" },
  { theme: "dark", fgKey: "textMuted", bgKey: "surface" },
  { theme: "dark", fgKey: "primary", bgKey: "background" },
  { theme: "dark", fgKey: "danger", bgKey: "background" },
  { theme: "dark", fgKey: "warning", bgKey: "background" },
  { theme: "dark", fgKey: "success", bgKey: "background" },
];

/** Precomputed text/background contrast pairs (ratio rounded to 2dp). */
export const contrastPairs: ContrastPair[] = PAIR_DEFS.map((d) => {
  const fg = themes[d.theme][d.fgKey];
  const bg = themes[d.theme][d.bgKey];
  return { theme: d.theme, fg, bg, ratio: Math.round(contrastRatio(fg, bg) * 100) / 100 };
});
