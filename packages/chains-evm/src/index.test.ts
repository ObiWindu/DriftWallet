// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  buildEvmSignerRequest,
  erc20TransferData,
  estimateFee,
  buildTokenTransfer,
  estimateFeeDetailed,
  isAllowedToken,
  EVM_TOKENS,
  getBalance,
  getHistory,
  broadcast,
  type GatewayFetch,
} from "./index.js";

describe("chains-evm", () => {
  it("builds signer request with u256 padding", () => {
    const r = buildEvmSignerRequest({
      chainId: 1, from: "0x0000000000000000000000000000000000000001",
      to: "0x000000000000000000000000000000000000dEaD",
      amountWei: "1000000000000000", nonce: 0, gasLimit: "21000",
      maxFeePerGasWei: "20000000000", maxPriorityFeePerGasWei: "1000000000", dataHex: "0x",
    });
    expect(r.value_wei_hex).toHaveLength(64);
    expect(estimateFee("21000", "20000000000")).toBe(420000000000000n);
  });
  it("encodes ERC20 transfer", () => {
    const d = erc20TransferData("0x000000000000000000000000000000000000dEaD", "1000");
    expect(d.startsWith("0xa9059cbb")).toBe(true);
  });
  it("blocks unknown chains", () => {
    expect(() => buildEvmSignerRequest({
      chainId: 999999, from: "0x0000000000000000000000000000000000000001",
      to: "0x0000000000000000000000000000000000000001",
      amountWei: "0", nonce: 0, gasLimit: "21000",
      maxFeePerGasWei: "1", maxPriorityFeePerGasWei: "1", dataHex: "0x",
    })).toThrow();
  });
});

function mockFetch(handler: (path: string, init?: RequestInit) => unknown): GatewayFetch {
  return (async (path: string, init?: RequestInit) => {
    const body = handler(path, init);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as GatewayFetch;
}

describe("chains-evm T006", () => {
  const USDC_ETH = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  it("EVM_TOKENS allowlist has checksummed USDC/USDT/WETH per chain", () => {
    for (const id of [1, 56, 137, 42161, 8453]) {
      const list = EVM_TOKENS[id];
      expect(list?.map((t) => t.symbol).sort()).toEqual(["USDC", "USDT", "WETH"]);
      for (const t of list ?? []) expect(t.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
    expect(isAllowedToken(1, USDC_ETH)).toBe(true);
    expect(isAllowedToken(1, USDC_ETH.toLowerCase())).toBe(true);
    expect(isAllowedToken(1, "0x000000000000000000000000000000000000dEaD")).toBe(false);
    expect(isAllowedToken(999999, USDC_ETH)).toBe(false);
  });
  it("buildTokenTransfer frames ERC-20 calldata with zero value", () => {
    const r = buildTokenTransfer({
      chainId: 1, from: "0x0000000000000000000000000000000000000001",
      token: USDC_ETH, to: "0x000000000000000000000000000000000000dEaD",
      amountBaseUnits: "1000000", nonce: 0, gasLimit: "60000",
      maxFeePerGasWei: "20000000000", maxPriorityFeePerGasWei: "1000000000",
    });
    expect(r.to).toBe(USDC_ETH.toLowerCase().slice(2));
    expect(r.value_wei_hex).toBe("0".repeat(64));
    expect(r.data_hex.startsWith("0xa9059cbb")).toBe(true);
    expect(() => buildTokenTransfer({
      chainId: 999999, from: "0x0000000000000000000000000000000000000001",
      token: USDC_ETH, to: "0x0000000000000000000000000000000000000001",
      amountBaseUnits: "1", nonce: 0, gasLimit: "60000",
      maxFeePerGasWei: "1", maxPriorityFeePerGasWei: "1",
    })).toThrow();
  });
  it("estimateFeeDetailed returns low/med/high bigint tiers", () => {
    const q = estimateFeeDetailed("21000", { low: "1000000000", med: "20000000000", high: "50000000000" });
    expect(q).toEqual({ low: 21000n * 1_000_000_000n, med: 21000n * 20_000_000_000n, high: 21000n * 50_000_000_000n });
    expect(() => estimateFeeDetailed("21000", { low: "5", med: "1", high: "9" })).toThrow();
  });
  it("getBalance/getHistory/broadcast use injected GatewayFetch (no network)", async () => {
    const seen: string[] = [];
    const fetchFn = mockFetch((path: string, init?: RequestInit) => {
      seen.push(`${init?.method ?? "GET"} ${path}`);
      if (path.includes("/balance/")) return { balanceWei: "1000000000000000000" };
      if (path.includes("/history/"))
        return { txs: [{ hash: `0x${"ab".repeat(32)}`, to: "0x1", valueWei: "5" }], nextCursor: "c1" };
      if (path.includes("/broadcast")) return { txHash: `0x${"cd".repeat(32)}` };
      throw new Error(`unexpected ${path}`);
    });
    const addr = "0x0000000000000000000000000000000000000001";
    expect(await getBalance(fetchFn, 1, addr)).toEqual({ wei: 10n ** 18n });
    const h = await getHistory(fetchFn, 1, addr);
    expect(h.txs[0]?.valueWei).toBe(5n);
    expect(h.nextCursor).toBe("c1");
    const b = await broadcast(fetchFn, 1, "0x02f86deadbeef");
    expect(b.txHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(seen.some((s) => s.includes("POST /v1/evm/1/broadcast"))).toBe(true);
    // validation: bad address, non-hex rawTx, bad chain
    await expect(getBalance(fetchFn, 1, "0xbad")).rejects.toThrow();
    await expect(broadcast(fetchFn, 1, "not-hex")).rejects.toThrow();
    await expect(broadcast(fetchFn, 999999, "0x1234")).rejects.toThrow();
  });
  it("broadcast surfaces gateway errors without network", async () => {
    const failing = (async () => new Response("oops", { status: 500 })) as GatewayFetch;
    await expect(broadcast(failing, 1, "0x02f86deadbeef")).rejects.toThrow(/gateway 500/);
    const badShape = mockFetch(() => ({ nope: true }));
    await expect(getBalance(badShape, 1, "0x0000000000000000000000000000000000000001")).rejects.toThrow();
  });
});
