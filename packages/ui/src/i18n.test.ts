// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import en from "./locales/en.json" with { type: "json" };
import es from "./locales/es.json" with { type: "json" };
import fr from "./locales/fr.json" with { type: "json" };
import { enKeys, getI18n, tFor, translate } from "./i18n.js";

describe("i18n", () => {
  it("en dictionary is complete and key-shaped", () => {
    const keys = enKeys();
    expect(keys.length).toBeGreaterThan(40);
    for (const k of keys) {
      expect(k).toMatch(/^[a-z]+\.[a-zA-Z]+$/);
      expect((en as Record<string, string>)[k]?.length).toBeGreaterThan(0);
    }
  });

  it("fr/es fall back to en per key", () => {
    expect(translate("fr", "common.continue")).toBe(
      (fr as Record<string, string>)["common.continue"],
    );
    // Not translated in fr/es -> en fallback.
    expect(translate("fr", "settings.wipe")).toBe((en as Record<string, string>)["settings.wipe"]);
    expect(translate("es", "settings.wipe")).toBe((en as Record<string, string>)["settings.wipe"]);
    expect(translate("es", "common.copy")).toBe((es as Record<string, string>)["common.copy"]);
    // Unknown key echoes the key (never undefined -> no blank UI).
    expect(translate("fr", "nope.missing")).toBe("nope.missing");
    expect(translate("de", "common.back")).toBe((en as Record<string, string>)["common.back"]);
  });

  it("tFor binds a language", () => {
    expect(tFor("es")("send.title")).toBe((es as Record<string, string>)["send.title"]);
    expect(tFor("es")("settings.wipe")).toBe((en as Record<string, string>)["settings.wipe"]);
  });

  it("i18next instance resolves with fallback", async () => {
    const i = await getI18n("fr");
    expect(i.t("common.back")).toBe("Retour");
    expect(i.t("settings.wipe")).toBe((en as Record<string, string>)["settings.wipe"]);
    const i2 = await getI18n("en");
    expect(i).toBe(i2);
  });
});
