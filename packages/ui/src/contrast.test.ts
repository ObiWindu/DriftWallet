// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { contrastPairs, contrastRatio, themes } from "./tokens.js";

const MIN_RATIO = 4.5;

describe("contrast (a11y gate, WCAG AA)", () => {
  it("every precomputed text/background pair meets 4.5:1", () => {
    expect(contrastPairs.length).toBeGreaterThan(0);
    for (const p of contrastPairs) {
      expect(
        p.ratio,
        `${p.theme} fg=${p.fg} bg=${p.bg} ratio=${p.ratio}`,
      ).toBeGreaterThanOrEqual(MIN_RATIO);
    }
  });

  it("ratio math matches WCAG references", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
  });

  it("palettes expose all required roles", () => {
    for (const name of ["light", "dark"] as const) {
      const p = themes[name];
      for (const role of [
        "background",
        "surface",
        "text",
        "textMuted",
        "primary",
        "danger",
        "warning",
        "success",
        "border",
      ] as const) {
        expect(p[role]).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });
});
