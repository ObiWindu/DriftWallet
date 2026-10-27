// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { formatUnits, parseUnits, DERIVATION_PATHS } from "./index.js";

describe("core money (bigint only)", () => {
  it("formats wei", () => {
    expect(formatUnits(1_000_000_000_000_000_000n, 18)).toBe("1");
    expect(formatUnits(1500000n, 6)).toBe("1.5");
  });
  it("parses without float", () => {
    expect(parseUnits("1.5", 6)).toBe(1500000n);
    expect(parseUnits("0.000000000000000001", 18)).toBe(1n);
  });
  it("rejects floats/over-precision", () => {
    expect(() => parseUnits("1.1234567", 6)).toThrow();
    expect(() => formatUnits(1n, 99)).toThrow();
  });
  it("derivation paths match spec", () => {
    expect(DERIVATION_PATHS.evm(0)).toBe("m/44'/60'/0'/0/0");
    expect(DERIVATION_PATHS.bitcoin(0)).toBe("m/84'/0'/0'/0/0");
  });
});

describe("core registry/fees/addresses (T004)", () => {
  it("MAINNET_ENABLED defaults to false", async () => {
    const m = await import("./index.js");
    expect(typeof m.MAINNET_ENABLED).toBe("boolean");
    // Default env in CI has no DRIFT_MAINNET set.
    if (!process.env["DRIFT_MAINNET"] && !process.env["EXPO_PUBLIC_DRIFT_MAINNET"]) {
      expect(m.MAINNET_ENABLED).toBe(false);
    }
  });
  it("TESTNETS covers all five EVM testnets", async () => {
    const { TESTNETS, EVM_TESTNETS } = await import("./index.js");
    expect(EVM_TESTNETS.map((t) => t.id).sort((a, b) => a - b)).toEqual([97, 80002, 84532, 421614, 11155111]);
    for (const t of EVM_TESTNETS) expect(TESTNETS[t.id]).toBe(t.name);
  });
  it("ChainRegistry resolves testnets, gates mainnet", async () => {
    const { ChainRegistry } = await import("./index.js");
    expect(ChainRegistry.getEvmChain(11155111).name).toBe("sepolia");
    expect(ChainRegistry.isAllowed(11155111)).toBe(true);
    expect(ChainRegistry.isAllowed(999999)).toBe(false);
    if (!process.env["DRIFT_MAINNET"]) {
      expect(ChainRegistry.isAllowed(1)).toBe(false);
      expect(() => ChainRegistry.getEvmChain(1)).toThrow();
    }
  });
  it("makeFeeQuote enforces ordering, bigint only", async () => {
    const { makeFeeQuote } = await import("./index.js");
    expect(makeFeeQuote(1n, 2n, 3n)).toEqual({ low: 1n, med: 2n, high: 3n });
    expect(() => makeFeeQuote(3n, 2n, 1n)).toThrow();
    expect(() => makeFeeQuote(-1n, 0n, 1n)).toThrow();
  });
  it("formatFiat uses integer math", async () => {
    const { formatFiat, parseUnits } = await import("./index.js");
    // 1.5 ETH @ $2000 = $3000.00
    expect(formatFiat(parseUnits("1.5", 18), 18, "2000")).toBe("$3000.00");
    expect(formatFiat(parseUnits("1.5", 18), 18, 2000)).toBe("$3000.00");
    expect(formatFiat(1_500_000n, 6, "2.5")).toBe("$3.75");
    expect(formatFiat(0n, 18, "1")).toBe("$0.00");
    expect(() => formatFiat(1n, 18, "bad")).toThrow();
  });
  it("validateAddress covers 0x/solana/btc/cardano", async () => {
    const { validateAddress } = await import("./index.js");
    expect(validateAddress("eip155:1", "0x0000000000000000000000000000000000000001")).toBe(true);
    expect(validateAddress(1, "0x0000000000000000000000000000000000000001")).toBe(true);
    expect(validateAddress("eip155:1", "0x123")).toBe(false);
    expect(validateAddress("solana:mainnet", "11111111111111111111111111111111")).toBe(true);
    expect(validateAddress("solana:devnet", "not-an-address!!")).toBe(false);
    expect(validateAddress("bip122:000000000019d6689c085ae165831e93", "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")).toBe(true);
    expect(validateAddress("bip122:000000000019d6689c085ae165831e93", "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kg3g4ty")).toBe(true);
    expect(validateAddress("bip122:000000000019d6689c085ae165831e93", "0x123")).toBe(false);
    expect(validateAddress("cardano:mainnet", "addr1" + "q".repeat(50))).toBe(true);
    expect(validateAddress("cardano:mainnet", "addr1short")).toBe(false);
    expect(validateAddress("unknown:chain", "whatever")).toBe(false);
  });
});
