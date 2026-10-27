// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { formatAmount, formatFiatCents, parseAmount, sanitizeDecimalInput } from "./amount.js";

// Deterministic PRNG (mulberry32) so the fuzz run is reproducible in CI.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DECIMALS = [0, 2, 6, 8, 9, 18];

describe("amount (bigint-only)", () => {
  it("formats known values", () => {
    expect(formatAmount(1n, 18)).toBe("0.000000000000000001"); // 1 wei
    expect(formatAmount(1_000_000_000_000_000_000n, 18)).toBe("1");
    expect(formatAmount(2_100_000_000_000_000n, 8)).toBe("21000000"); // 21M BTC in sats
    expect(formatAmount(0n, 6)).toBe("0");
    expect(formatAmount(-150n, 2)).toBe("-1.5");
  });

  it("parses known values", () => {
    expect(parseAmount("0.000000000000000001", 18)).toBe(1n);
    expect(parseAmount("21000000", 8)).toBe(2_100_000_000_000_000n);
    expect(parseAmount("  1.5  ", 2)).toBe(150n);
  });

  it("rejects bad input without floats", () => {
    expect(() => parseAmount("1.234", 2)).toThrow();
    expect(() => parseAmount("abc", 18)).toThrow();
    expect(() => parseAmount("1e5", 18)).toThrow();
    expect(() => parseAmount("", 18)).toThrow();
    expect(() => formatAmount(1n, 37)).toThrow();
  });

  it("round-trips parse(format(x)) === x (10k fuzz incl. 1 wei and 21M BTC)", () => {
    const rand = rng(12345);
    const edge: Array<[bigint, number]> = [
      [1n, 18], // 1 wei
      [1n, 8], // 1 sat
      [2_100_000_000_000_000n, 8], // 21M BTC in sats
      [(1n << 256n) - 1n, 18], // max uint256
      [0n, 0],
    ];
    for (const [v, d] of edge) {
      expect(parseAmount(formatAmount(v, d), d)).toBe(v);
    }
    for (let i = 0; i < 10_000; i++) {
      const d = DECIMALS[Math.floor(rand() * DECIMALS.length)] as number;
      // Random magnitude: small values (dust/wei) and huge values (whale supply).
      const limbs = Math.floor(rand() * 4);
      let v = BigInt(Math.floor(rand() * 1_000_000_000));
      for (let k = 0; k < limbs; k++) v = v * 1_000_000_007n + BigInt(Math.floor(rand() * 1_000_000));
      if (rand() < 0.2) v = v % 1_000_000n; // bias toward dust
      expect(parseAmount(formatAmount(v, d), d)).toBe(v);
    }
  });

  it("sanitizes decimal input for text fields", () => {
    expect(sanitizeDecimalInput("12.3456", 2)).toBe("12.34");
    expect(sanitizeDecimalInput("abc1.5def", 2)).toBe("1.5");
    expect(sanitizeDecimalInput("007", 2)).toBe("7");
    expect(sanitizeDecimalInput("00.5", 2)).toBe("0.5");
    expect(sanitizeDecimalInput("1.2.3", 2)).toBe("1.23");
    expect(sanitizeDecimalInput("", 2)).toBe("");
    expect(sanitizeDecimalInput("1.99", 0)).toBe("1");
  });

  it("formats fiat from integer cents", () => {
    // 1.5 ETH @ $2000.00 = $3000.00
    expect(formatFiatCents(1_500_000_000_000_000_000n, 18, 200_000n)).toBe("$3000.00");
    expect(formatFiatCents(1n, 18, 200_000n)).toBe("$0.00"); // dust truncates, never NaN
    expect(() => formatFiatCents(1n, 18, -5n)).toThrow();
  });
});
