// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// U000 property tests: parse/format roundtrip + integer-cents portfolio math.
import { describe, expect, it } from "vitest";
import {
  assetValueCents,
  buildPortfolioModel,
  formatBalance,
  formatCents,
  parseBalance,
  priceToCents,
} from "./popup.js";

/** Deterministic PRNG (mulberry32) — fuzz without flaky randomness. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("formatBalance/parseBalance roundtrip", () => {
  it("roundtrips dust amounts (1 wei, 1 sat, 1 lovelace)", () => {
    expect(parseBalance(formatBalance("1", 18), 18)).toBe(1n);
    expect(parseBalance(formatBalance("1", 8), 8)).toBe(1n);
    expect(parseBalance(formatBalance("1", 6), 6)).toBe(1n);
    expect(parseBalance(formatBalance("0", 18), 18)).toBe(0n);
    expect(formatBalance("1", 18)).toBe("0.000000000000000001");
  });

  it("roundtrips 21M BTC and max uint256-scale values", () => {
    const btc = "2100000000000000"; // 21M BTC in sats
    expect(parseBalance(formatBalance(btc, 8), 8)).toBe(BigInt(btc));
    const huge = (1n << 256n) - 1n;
    expect(parseBalance(formatBalance(huge.toString(), 18), 18)).toBe(huge);
  });

  it("fuzz: parse(format(x)) === x for 10k cases", () => {
    const rand = mulberry32(42);
    const decimalsSet = [0, 6, 8, 18];
    for (let i = 0; i < 10_000; i++) {
      const dec = decimalsSet[Math.floor(rand() * decimalsSet.length)] as number;
      // Mix magnitudes: dust, small, realistic, huge (up to 2^200).
      const bucket = rand();
      let x: bigint;
      if (bucket < 0.25) {
        x = BigInt(Math.floor(rand() * 1000));
      } else if (bucket < 0.5) {
        x = BigInt(Math.floor(rand() * 1e12)) * 1000n + BigInt(Math.floor(rand() * 1000));
      } else if (bucket < 0.75) {
        x = (BigInt(Math.floor(rand() * 2 ** 32)) << 64n) + BigInt(Math.floor(rand() * 2 ** 32));
      } else {
        x = (1n << BigInt(150 + Math.floor(rand() * 50))) + BigInt(Math.floor(rand() * 1e6));
      }
      const neg = rand() < 0.1 ? "-" : "";
      const minor = neg + x.toString();
      expect(parseBalance(formatBalance(minor, dec), dec)).toBe(BigInt(minor));
    }
  });

  it("rejects malformed input", () => {
    expect(() => parseBalance("1.234", 2)).toThrow();
    expect(() => parseBalance("abc", 18)).toThrow();
    expect(() => parseBalance("", 18)).toThrow();
    expect(() => formatBalance("12.5", 18)).toThrow();
    expect(() => formatBalance("1", 37)).toThrow();
  });
});

describe("integer-cents fiat math", () => {
  it("prices: exact strings, numbers round once", () => {
    expect(priceToCents("2999.99")).toBe(299999n);
    expect(priceToCents("1")).toBe(100n);
    expect(priceToCents(0.1 + 0.2)).toBe(30n); // 0.30000000000000004 → 30c
    expect(() => priceToCents("1.999")).toThrow();
    expect(() => priceToCents(-5)).toThrow();
  });

  it("formats cents without float", () => {
    expect(formatCents(1234n)).toBe("12.34");
    expect(formatCents(-1n)).toBe("-0.01");
    expect(formatCents(0n)).toBe("0.00");
  });

  it("dust truncates to zero, never NaN", () => {
    // 1 wei at $3000/ETH is far below one cent.
    expect(assetValueCents("1", 18, "3000")).toBe(0n);
    expect(formatCents(assetValueCents("1", 18, "3000"))).toBe("0.00");
    // 1 ETH at $3000 exactly.
    expect(assetValueCents("1000000000000000000", 18, "3000")).toBe(300000n);
  });

  it("portfolio totals in integer cents (no float drift)", () => {
    const model = buildPortfolioModel(
      [
        { chain: "eip155:1", symbol: "ETH", balanceMinor: "1000000000000000000", decimals: 18, priceUsd: "3000" },
        { chain: "solana:mainnet", symbol: "SOL", balanceMinor: "2500000000", decimals: 9, priceUsd: "150.10" },
        { chain: "eip155:1", symbol: "DUST", balanceMinor: "1", decimals: 18, priceUsd: "3000" },
      ],
      "2026-01-01T00:00:00.000Z",
    );
    expect(model.rows[0]?.valueUsd).toBe("3000.00");
    expect(model.rows[1]?.valueUsd).toBe("375.25"); // 2.5 * 150.10
    expect(model.rows[2]?.valueUsd).toBe("0.00");
    expect(model.totalUsd).toBe("3375.25");
    expect(model.updatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("0.1 + 0.2 style accumulation stays exact", () => {
    // Ten rows of 0.1 USDC each must total exactly 1.00.
    const rows = Array.from({ length: 10 }, (_, i) => ({
      chain: "eip155:1",
      symbol: `U${i}`,
      balanceMinor: "100000",
      decimals: 6,
      priceUsd: "1" as const,
    }));
    expect(buildPortfolioModel(rows).totalUsd).toBe("1.00");
  });
});
