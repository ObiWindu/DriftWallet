// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  aggregatePortfolio,
  changeBps,
  downsampleSeries,
  holdingValueUsdCents,
  priceToMicroUsd,
  totalPnlUsdCents,
  type Holding,
} from "./portfolio.js";

describe("portfolio — integer money math", () => {
  it("priceToMicroUsd parses exact decimal prices (1e-4 USD units)", () => {
    expect(priceToMicroUsd("3200.5")).toBe(32_005_000n);
    expect(priceToMicroUsd("0.0001")).toBe(1n);
    expect(priceToMicroUsd("150")).toBe(1_500_000n);
    expect(() => priceToMicroUsd("1.00001")).toThrow(); // >4 decimals rejected
    expect(() => priceToMicroUsd("abc")).toThrow();
  });

  it("holdingValueUsdCents uses bigint only", () => {
    const eth: Holding = {
      chain: "eip155:1", asset: "ETH", symbol: "ETH",
      balanceBaseUnits: "1500000000000000000", decimals: 18, priceUsd: "3200.50",
    };
    expect(holdingValueUsdCents(eth)).toBe(480_075n); // 1.5 ETH * $3200.50 = $4,800.75 = 480075 cents
    const none: Holding = { ...eth, priceUsd: null };
    expect(holdingValueUsdCents(none)).toBe(0n);
  });

  it("aggregatePortfolio totals, allocates in bps, flags stale", () => {
    const now = 1_000_000;
    const holdings: Holding[] = [
      { chain: "eip155:1", asset: "ETH", symbol: "ETH", balanceBaseUnits: "1000000000000000000", decimals: 18, priceUsd: "2000", priceAtMs: now, costBasisUsdCents: "150000" },
      { chain: "eip155:1", asset: "USDC", symbol: "USDC", balanceBaseUnits: "1000000000", decimals: 6, priceUsd: "1", priceAtMs: now, costBasisUsdCents: "100000" },
      { chain: "solana:mainnet", asset: "SOL", symbol: "SOL", balanceBaseUnits: "5000000000", decimals: 9, priceUsd: "100", priceAtMs: now - 10 * 60_000 }, // stale
      { chain: "bip122:x", asset: "BTC", symbol: "BTC", balanceBaseUnits: "100000000", decimals: 8, priceUsd: null }, // unknown
    ];
    const s = aggregatePortfolio(holdings, { nowMs: now });
    // ETH $2000 + USDC $1000 = $3000 -> 300000 cents
    expect(s.totalUsdCents).toBe("300000");
    expect(s.staleAssets.sort()).toEqual(["BTC@bip122:x", "SOL@solana:mainnet"]);
    expect(s.allocation).toHaveLength(2);
    expect(s.allocation[0]?.asset).toBe("ETH");
    expect(s.allocation[0]?.pctBps).toBe(6666); // 2/3 of total
    expect(s.allocation[1]?.pctBps).toBe(3333);
    expect(s.pnlUsdCents).toBeDefined();
    // ETH: 200000 - 150000 = +50000 cents; USDC: 100000 - 100000 = 0
    expect(totalPnlUsdCents(s)).toBe(50_000n);
  });

  it("empty portfolio totals zero with no allocation", () => {
    const s = aggregatePortfolio([], { nowMs: 1 });
    expect(s.totalUsdCents).toBe("0");
    expect(s.allocation).toEqual([]);
    expect(s.staleAssets).toEqual([]);
  });
});

describe("portfolio — series helpers", () => {
  const series = Array.from({ length: 100 }, (_, i) => ({ t: i, p: i === 0 ? 100 : 100 + Math.sin(i / 5) * 20 + i }));

  it("downsampleSeries preserves shape and endpoints", () => {
    const out = downsampleSeries(series, 10);
    expect(out).toHaveLength(10);
    expect(out[0]?.p).toBe(series[0]?.p);
    expect(out[out.length - 1]?.p).toBe(series[series.length - 1]?.p);
    // no point outside the original min/max range
    const min = Math.min(...series.map((p) => p.p));
    const max = Math.max(...series.map((p) => p.p));
    for (const p of out) {
      expect(p.p).toBeGreaterThanOrEqual(min - 1e-9);
      expect(p.p).toBeLessThanOrEqual(max + 1e-9);
    }
    // already small enough -> unchanged
    expect(downsampleSeries(series.slice(0, 5), 10)).toHaveLength(5);
  });

  it("changeBps computes signed basis points", () => {
    expect(changeBps([{ t: 0, p: 100 }, { t: 1, p: 110 }])).toBe("1000");
    expect(changeBps([{ t: 0, p: 100 }, { t: 1, p: 90 }])).toBe("-1000");
    expect(() => changeBps([{ t: 0, p: 0 }, { t: 1, p: 1 }])).toThrow();
    expect(() => changeBps([{ t: 0, p: 1 }])).toThrow();
  });
});
