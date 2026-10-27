// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { minAdaLovelace, buildTxSkeleton, validateAdaAddress, witnessPaths, normalizeAdaPath } from "./index.js";

const ADDR = "addr1" + "q".repeat(55);
const ADDR2 = "addr1" + "p".repeat(55);
const CHANGE = "addr1" + "z".repeat(55);

describe("chains-cardano", () => {
  it("min ADA", () => {
    expect(minAdaLovelace()).toBe(1_000_000n);
  });
  it("normalizeAdaPath passes standard CIP-1852 paths through", () => {
    expect(normalizeAdaPath("m/1852'/1815'/0'/0/0")).toBe("m/1852'/1815'/0'/0/0");
    expect(normalizeAdaPath("m/1852'/1815'/0'/1/3")).toBe("m/1852'/1815'/0'/1/3");
    expect(() => normalizeAdaPath("m/44'/60'/0'/0/0")).toThrow();
    expect(() => normalizeAdaPath("m/1852'/1815'/0'/0")).toThrow();
  });
});

describe("chains-cardano T006", () => {
  it("buildTxSkeleton balances outputs + fee + change", () => {
    const s = buildTxSkeleton({
      inputs: [{ txHash: "ab".repeat(32), index: 0, lovelace: "5000000" }],
      outputs: [{ address: ADDR, lovelace: "2000000" }],
      feeLovelace: "200000",
      changeAddress: CHANGE,
    });
    expect(s.totalInLovelace).toBe(5000000n);
    expect(s.changeLovelace).toBe(2800000n);
    expect(s.outputs).toHaveLength(2);
    expect(s.outputs[1]).toEqual({ address: CHANGE, lovelace: 2800000n });
  });
  it("enforces min-ADA on outputs and change, rejects underfunding", () => {
    // Output below min-ADA.
    expect(() => buildTxSkeleton({
      inputs: [{ txHash: "ab".repeat(32), index: 0, lovelace: "5000000" }],
      outputs: [{ address: ADDR, lovelace: "500" }],
      feeLovelace: "200000",
      changeAddress: CHANGE,
    })).toThrow(/min-ADA/);
    // Insufficient funds.
    expect(() => buildTxSkeleton({
      inputs: [{ txHash: "ab".repeat(32), index: 0, lovelace: "1000000" }],
      outputs: [{ address: ADDR, lovelace: "1000000" }],
      feeLovelace: "200000",
      changeAddress: CHANGE,
    })).toThrow(/insufficient/);
    // Dust change.
    expect(() => buildTxSkeleton({
      inputs: [{ txHash: "ab".repeat(32), index: 0, lovelace: "2200500" }],
      outputs: [{ address: ADDR, lovelace: "2000000" }],
      feeLovelace: "200000",
      changeAddress: CHANGE,
    })).toThrow(/min-ADA/);
    // Zero change omits change output.
    const exact = buildTxSkeleton({
      inputs: [{ txHash: "ab".repeat(32), index: 0, lovelace: "2200000" }],
      outputs: [{ address: ADDR, lovelace: "2000000" }],
      feeLovelace: "200000",
      changeAddress: CHANGE,
    });
    expect(exact.changeLovelace).toBe(0n);
    expect(exact.outputs).toHaveLength(1);
  });
  it("validateAdaAddress checks prefix and length", () => {
    expect(validateAdaAddress(ADDR)).toBe(true);
    expect(validateAdaAddress("addr_test1" + "q".repeat(50))).toBe(true);
    expect(validateAdaAddress("addr1short")).toBe(false);
    expect(validateAdaAddress("0x1234")).toBe(false);
    expect(validateAdaAddress("addr1" + "Q".repeat(55))).toBe(false); // uppercase not bech32
    expect(ADDR2.length).toBeGreaterThanOrEqual(50);
  });
  it("witnessPaths follows CIP-1852 external chain", () => {
    expect(witnessPaths(0, 2)).toEqual(["m/1852'/1815'/0'/0/0", "m/1852'/1815'/0'/0/1"]);
    expect(witnessPaths(3, 1)).toEqual(["m/1852'/1815'/3'/0/0"]);
    expect(() => witnessPaths(-1, 1)).toThrow();
    expect(() => witnessPaths(0, 0)).toThrow();
  });
});
