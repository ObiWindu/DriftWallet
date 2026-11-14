// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  defaultRulesFor,
  evaluateAlerts,
  Watchlist,
  type AlertRuleV2,
} from "./price-alerts.js";

describe("watchlist", () => {
  it("add/has/remove/list + export/import round-trip", () => {
    const w = new Watchlist();
    w.add("eth", 1000);
    w.add("SOL", 2000, "satellite");
    expect(w.has("ETH")).toBe(true);
    expect(w.assets()).toEqual(["ETH", "SOL"]);
    const json = w.exportJSON();
    const w2 = new Watchlist();
    w2.importJSON(json);
    expect(w2.list().map((i) => i.asset)).toEqual(["ETH", "SOL"]);
    expect(w2.list()[1]?.note).toBe("satellite");
    expect(w.remove("eth")).toBe(true);
    expect(w.has("ETH")).toBe(false);
    expect(() => w.add("TOOLONGASSET1")).toThrow();
  });
});

describe("price alert evaluation", () => {
  const rules: AlertRuleV2[] = [
    { kind: "priceAbove", id: "r1", asset: "ETH", thresholdUsd: 3000 },
    { kind: "priceBelow", id: "r2", asset: "ETH", thresholdUsd: 2500 },
    { kind: "pctMove", id: "r3", asset: "SOL", thresholdBps: 500 },
  ];

  it("fires above/below on strict crossing only", () => {
    const hits = evaluateAlerts(rules, { prices: { ETH: 3100, SOL: 100 } }, 42);
    expect(hits.map((h) => h.ruleId)).toEqual(["r1"]);
    const at = evaluateAlerts(rules, { prices: { ETH: 3000, SOL: 100 } }, 42); // == threshold: no fire
    expect(at).toEqual([]);
    const below = evaluateAlerts(rules, { prices: { ETH: 2400, SOL: 100 } }, 42);
    expect(below.map((h) => h.ruleId)).toEqual(["r2"]);
  });

  it("pctMove fires on |change| >= threshold using the series", () => {
    const series = { SOL: [{ t: 0, p: 100 }, { t: 1, p: 106 }] }; // +6% = 600bps
    const hits = evaluateAlerts(rules, { prices: { ETH: 2800, SOL: 106 }, series }, 42);
    expect(hits.map((h) => h.ruleId)).toEqual(["r3"]);
    expect(hits[0]?.title).toContain("+6.00%");
    const calm = evaluateAlerts(rules, { prices: { ETH: 2800, SOL: 102 }, series: { SOL: [{ t: 0, p: 100 }, { t: 1, p: 102 }] } }, 42);
    expect(calm).toEqual([]);
  });

  it("unknown assets simply do not fire", () => {
    const hits = evaluateAlerts(rules, { prices: {}, series: {} }, 42);
    expect(hits).toEqual([]);
  });

  it("defaultRulesFor builds +/-10% rules around current price", () => {
    const rs = defaultRulesFor("ETH", 2000);
    expect(rs).toHaveLength(2);
    expect(rs[0]).toMatchObject({ kind: "priceAbove", thresholdUsd: 2200 });
    expect(rs[1]).toMatchObject({ kind: "priceBelow", thresholdUsd: 1800 });
  });
});
