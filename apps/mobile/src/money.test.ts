// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { formatFiatCents, formatUnits, parseUnits, scaleCeil } from "./money.js";

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

describe("mobile money (bigint-only, mirrors core)", () => {
  it("formats and parses spot values", () => {
    expect(formatUnits(1n, 18)).toBe("0.000000000000000001");
    expect(formatUnits(2_100_000_000_000_000n, 8)).toBe("21000000");
    expect(parseUnits("0.000000000000000001", 18)).toBe(1n);
    expect(parseUnits("21000000", 8)).toBe(2_100_000_000_000_000n);
    expect(() => parseUnits("1.234", 2)).toThrow();
    expect(() => parseUnits("1e5", 18)).toThrow();
  });

  it("round-trips parse(format(x)) === x (2k fuzz + edges)", () => {
    const rand = rng(987654321);
    const edge: Array<[bigint, number]> = [
      [1n, 18],
      [1n, 8],
      [2_100_000_000_000_000n, 8],
      [(1n << 256n) - 1n, 18],
    ];
    for (const [v, d] of edge) expect(parseUnits(formatUnits(v, d), d)).toBe(v);
    const decs = [0, 6, 8, 18];
    for (let i = 0; i < 2000; i++) {
      const d = decs[Math.floor(rand() * decs.length)] as number;
      let v = BigInt(Math.floor(rand() * 1_000_000_000));
      if (rand() < 0.5) v = v * 1_000_000_007n + BigInt(Math.floor(rand() * 1_000_000));
      if (rand() < 0.2) v = v % 997n;
      expect(parseUnits(formatUnits(v, d), d)).toBe(v);
    }
  });

  it("formats fiat from integer cents", () => {
    expect(formatFiatCents(1_500_000_000_000_000_000n, 18, 200_000n)).toBe("$3000.00");
    expect(formatFiatCents(1n, 18, 200_000n)).toBe("$0.00");
    expect(() => formatFiatCents(1n, 18, -1n)).toThrow();
  });

  it("scales fees with ceiling", () => {
    expect(scaleCeil(1000n, 4n, 5n)).toBe(800n);
    expect(scaleCeil(1001n, 4n, 5n)).toBe(801n);
    expect(scaleCeil(1n, 4n, 5n)).toBe(1n); // dust never rounds to zero fee
    expect(() => scaleCeil(-1n, 1n, 1n)).toThrow();
  });
});
