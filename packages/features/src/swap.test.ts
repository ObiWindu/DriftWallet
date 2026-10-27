// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  allowancePlan,
  buildSwapParams,
  fetchSwapQuote,
  priceImpactTier,
  reviewSwap,
  type SwapParams,
} from "./swap.js";

const SELL = "0x1111111111111111111111111111111111111111";
const BUY = "0x2222222222222222222222222222222222222222";

function params(overrides: Partial<SwapParams> = {}): SwapParams {
  return {
    chain: "eip155:1",
    sellToken: SELL,
    buyToken: BUY,
    amountBaseUnits: "1000000",
    slippageBps: 50,
    recipient: "0x3333333333333333333333333333333333333333",
    ...overrides,
  };
}

describe("swap", () => {
  it("validates swap params incl. slippage range", () => {
    expect(buildSwapParams(params()).slippageBps).toBe(50);
    expect(() => buildSwapParams(params({ slippageBps: 0 }))).toThrow();
    expect(() => buildSwapParams(params({ slippageBps: 5001 }))).toThrow();
    expect(buildSwapParams(params({ slippageBps: 5000 })).slippageBps).toBe(5000);
    expect(() => buildSwapParams(params({ sellToken: SELL, buyToken: SELL }))).toThrow();
    expect(() => buildSwapParams(params({ amountBaseUnits: "0" }))).toThrow();
    expect(() => buildSwapParams(params({ amountBaseUnits: "1.5" }))).toThrow();
  });

  it("tiers price impact at 3% / 10%", () => {
    expect(priceImpactTier(0)).toBe("ok");
    expect(priceImpactTier("2.99")).toBe("ok");
    expect(priceImpactTier(3)).toBe("warn");
    expect(priceImpactTier(9.99)).toBe("warn");
    expect(priceImpactTier(10)).toBe("block");
    expect(priceImpactTier(42)).toBe("block");
    expect(() => priceImpactTier(-1)).toThrow();
    expect(() => priceImpactTier("abc")).toThrow();
  });

  it("plans exact approval by default; infinite needs flag + reason", () => {
    expect(allowancePlan("0", "1000")).toMatchObject({ mode: "exact", amountBaseUnits: "1000" });
    // sufficient allowance -> no new approval
    expect(allowancePlan("1000", "1000")).toMatchObject({ mode: "exact", amountBaseUnits: "0" });
    expect(allowancePlan("5000", "1000")).toMatchObject({ mode: "exact", amountBaseUnits: "0" });
    // infinite without a reason throws (flag + reason string both required)
    expect(() => allowancePlan("0", "1000", { allowInfinite: true })).toThrow();
    expect(() => allowancePlan("0", "1000", { allowInfinite: true, reason: "  " })).toThrow();
    const inf = allowancePlan("0", "1000", { allowInfinite: true, reason: "save gas on recurring swaps" });
    expect(inf.mode).toBe("infinite");
    expect(BigInt(inf.amountBaseUnits)).toBe((1n << 256n) - 1n);
  });

  it("fetches quotes via injected fn and validates them (no network)", async () => {
    const p = buildSwapParams(params());
    const quote = await fetchSwapQuote(p, async () => ({
      sellToken: SELL,
      buyToken: BUY,
      sellAmountBaseUnits: "1000000",
      buyAmountBaseUnits: "990000",
      priceImpactPct: "1.2",
    }));
    expect(quote.buyAmountBaseUnits).toBe("990000");

    // transport returning garbage is rejected
    await expect(fetchSwapQuote(p, async () => ({ nope: true }))).rejects.toThrow();
    // token mismatch is rejected
    await expect(
      fetchSwapQuote(p, async () => ({
        sellToken: SELL,
        buyToken: "0x9999999999999999999999999999999999999999",
        sellAmountBaseUnits: "1000000",
        buyAmountBaseUnits: "1",
        priceImpactPct: "99",
      })),
    ).rejects.toThrow();

    const review = reviewSwap(p, quote, "0");
    expect(review.impactTier).toBe("ok");
    expect(review.allowance.mode).toBe("exact");
    const blocked = reviewSwap(
      p,
      { ...quote, priceImpactPct: "12.5" },
      "0",
      { allowInfinite: true, reason: "user typed confirmation" },
    );
    expect(blocked.impactTier).toBe("block");
    expect(blocked.warnings.length).toBeGreaterThanOrEqual(2);
  });
});
