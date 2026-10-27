// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// U020/U022 tests: theme helpers, i18n coverage, full-page app model.
import { describe, expect, it } from "vitest";
import { formatTokenAmount, themeFor, toneForVerdict, truncateAddress } from "./theme.js";
import { allKeys, createExtensionI18n, SUPPORTED_LOCALES } from "./i18n.js";
import {
  defaultSettings,
  explorerLink,
  onboardingFor,
  updateSettings,
  visibleActivity,
} from "./app-model.js";
import type { ActivityItem } from "./app-model.js";

describe("theme helpers", () => {
  it("resolves modes + formats bigint amounts", () => {
    expect(themeFor("light").mode).toBe("light");
    expect(themeFor("dark").bg).not.toBe(themeFor("light").bg);
    expect(formatTokenAmount("1000000000000000000", 18)).toBe("1");
    expect(truncateAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
    expect(truncateAddress("abc")).toBe("abc");
    expect(toneForVerdict("deny")).toBe("bad");
  });
});

describe("i18n", () => {
  it("translates every key in en/fr/es with no missing keys", () => {
    const keys = allKeys();
    expect(keys.length).toBeGreaterThan(10);
    for (const lng of SUPPORTED_LOCALES) {
      const t = createExtensionI18n(lng).t.bind(createExtensionI18n(lng));
      for (const k of keys) {
        const v = t(k);
        expect(v).not.toBe(k);
      }
    }
    const fr = createExtensionI18n("fr");
    expect(fr.t("settings.title")).toBe("Paramètres");
    expect(createExtensionI18n("es").t("approval.approve")).toBe("Aprobar");
    expect(createExtensionI18n().t("settings.title")).toBe("Settings");
  });

  it("interpolates counts", () => {
    expect(createExtensionI18n("en").t("popup.approve", { count: 3 })).toContain("3");
  });
});

describe("full-page app model", () => {
  const items: ActivityItem[] = [
    { id: "1", chain: "eip155:1", kind: "send", status: "confirmed", txHash: "0x1", at: 2, hiddenAsSpam: false },
    { id: "2", chain: "eip155:1", kind: "airdrop", status: "confirmed", txHash: "0x2", at: 3, hiddenAsSpam: true },
    { id: "3", chain: "solana:mainnet", kind: "send", status: "pending", txHash: "s1", at: 1, hiddenAsSpam: false },
  ];

  it("onboarding progress ascends", () => {
    const steps = ["entry", "password", "backup", "quiz", "done"] as const;
    const progresses = steps.map((s) => onboardingFor(s).progress);
    expect([...progresses].sort((a, b) => a - b)).toEqual(progresses);
    expect(progresses[progresses.length - 1]).toBe(1);
  });

  it("hides spam + sorts newest first", () => {
    const visible = visibleActivity(items, defaultSettings());
    expect(visible.map((i) => i.id)).toEqual(["1", "3"]);
    const all = visibleActivity(items, updateSettings(defaultSettings(), { spamHide: false }));
    expect(all.map((i) => i.id)).toEqual(["2", "1", "3"]);
  });

  it("validates settings ranges", () => {
    expect(() => updateSettings(defaultSettings(), { autoLockSecs: 5 })).toThrow();
    expect(updateSettings(defaultSettings(), { biometrics: true }).biometrics).toBe(true);
  });

  it("builds explorer links", () => {
    expect(explorerLink("eip155:1", "0xabc")).toBe("https://etherscan.io/tx/0xabc");
    expect(explorerLink("unknown:chain", "x")).toBeNull();
  });
});
