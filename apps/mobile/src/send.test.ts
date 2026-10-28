// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { gateSend, pickFee, quoteFee, requiresBiometric, validateAddress } from "./send.js";

describe("send helpers", () => {
  it("validates addresses per chain", () => {
    expect(validateAddress("ethereum", "0x" + "ab".repeat(20))).toBe(true);
    expect(validateAddress("ethereum", "0x123")).toBe(false);
    expect(validateAddress("solana", "11111111111111111111111111111111")).toBe(true);
    expect(validateAddress("solana", "0x" + "ab".repeat(20))).toBe(false);
    expect(validateAddress("cardano", "addr1qyq95cd4n0x3t9f0ul")).toBe(true);
    expect(validateAddress("cardano", "0x123")).toBe(false);
    expect(validateAddress("bitcoin", "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")).toBe(true);
    expect(validateAddress("bitcoin", "nope")).toBe(false);
  });

  it("picks fees low/med/high", () => {
    expect(pickFee("low").multiplier).toBeLessThan(pickFee("med").multiplier);
    expect(pickFee("med").multiplier).toBeLessThan(pickFee("high").multiplier);
    expect(quoteFee(1000n, "med")).toBe(1000n);
    expect(quoteFee(1000n, "high")).toBe(1500n);
  });

  it("gates amounts over $100 on biometrics", () => {
    expect(requiresBiometric(10_000n)).toBe(false);
    expect(requiresBiometric(10_001n)).toBe(true);
    expect(gateSend(5_000n, false).allowed).toBe(true);
    expect(gateSend(50_000n, false).allowed).toBe(false);
    expect(gateSend(50_000n, true).allowed).toBe(true);
  });
});
