// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { autoLockPresets, confirmWipe, exportVisibility, networkOptions, setAutoLock } from "./settings.js";

describe("settings screen VM", () => {
  it("offers presets within store bounds", () => {
    const presets = autoLockPresets();
    expect(presets).toEqual([30_000, 60_000, 300_000, 900_000, 1_800_000]);
    for (const p of presets) expect(setAutoLock(p)).toEqual({ ok: true, ms: p });
  });

  it("rejects out-of-range or non-integer auto-lock values", () => {
    expect(setAutoLock(29_999)).toEqual({ ok: false, errorKey: "settings.autoLock" });
    expect(setAutoLock(1_800_001)).toEqual({ ok: false, errorKey: "settings.autoLock" });
    expect(setAutoLock(1.5)).toEqual({ ok: false, errorKey: "settings.autoLock" });
    expect(setAutoLock("fast")).toEqual({ ok: false, errorKey: "settings.autoLock" });
  });

  it("auto-clears the exported seed after the visibility window", () => {
    expect(exportVisibility(0, 0)).toEqual({ visible: true, remainingMs: 30_000 });
    expect(exportVisibility(29_999, 0).visible).toBe(true);
    expect(exportVisibility(30_000, 0)).toEqual({ visible: false, remainingMs: 0 });
    expect(exportVisibility(99_999, 0).visible).toBe(false);
  });

  it("requires typing WIPE to confirm destruction", () => {
    expect(confirmWipe("WIPE").confirmed).toBe(true);
    expect(confirmWipe("WIPE").errorKey).toBe(null);
    expect(confirmWipe("wipe").errorKey).toBe("settings.wipeConfirm");
    expect(confirmWipe("").hintKey).toBe("settings.wipePlaceholder");
    expect(confirmWipe(null).confirmed).toBe(false);
  });

  it("disables mainnet when the build flag is off", () => {
    expect(networkOptions(false)).toEqual([
      { id: "mainnet", labelKey: "settings.mainnet", selectable: false },
      { id: "testnet", labelKey: "settings.testnet", selectable: true },
    ]);
    expect(networkOptions(true)[0]?.selectable).toBe(true);
  });
});
