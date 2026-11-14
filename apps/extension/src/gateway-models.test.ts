// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  assertPortfolioGateway,
  loadActivity,
  loadHoldings,
  loadPortfolioView,
  loadSwapReview,
  resolveSendRecipient,
  type AccountView,
  type PortfolioGateway,
} from "./gateway-models.js";
import { defaultSettings } from "./app-model.js";

const ACCT: AccountView = {
  name: "Account 1",
  addresses: {
    "eip155:1": "0x1111111111111111111111111111111111111111",
    "solana:mainnet": "So1111111111111111111111111111111111111111",
  },
};

function stubClient(overrides?: Partial<PortfolioGateway>): PortfolioGateway {
  return {
    getPrices: async () => ({ ETH: 2000, SOL: 100 }),
    getEvmBalance: async () => 2_000_000_000_000_000_000n, // 2 ETH
    getSolBalance: async () => 5_000_000_000n, // 5 SOL
    getEvmTokenBalances: async () => ({
      stub: false,
      tokens: [{ address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6, balanceBaseUnits: 1_500_000_000n }],
    }),
    getSolTokenBalances: async () => ({ stub: false, tokens: [] }),
    getEvmTxStatus: async () => ({ stub: false, status: "success", blockNumber: 16n, gasUsed: 21000n }),
    getSolTxStatus: async () => ({ stub: false, status: "pending", slot: null, err: null }),
    getSwapQuote: async () => ({
      stub: false,
      quote: {
        sellToken: "native", buyToken: "USDC",
        sellAmountBaseUnits: 1_000_000_000_000_000_000n,
        buyAmountBaseUnits: 2_000_000_000n,
        priceImpactPct: "0.42",
        allowanceNeededBaseUnits: 0n,
      },
    }),
    ...overrides,
  };
}

describe("gateway-models — portfolio", () => {
  it("loadHoldings aggregates EVM + SOL natives and tokens", async () => {
    const hs = await loadHoldings(stubClient(), ACCT, { nowMs: 1000, priceAtMs: 1000 });
    const eth = hs.find((h) => h.asset === "ETH" && h.chain === "eip155:1");
    expect(eth?.balanceBaseUnits).toBe("2000000000000000000");
    expect(eth?.priceUsd).toBe("2000.0000");
    const usdc = hs.find((h) => h.symbol === "USDC");
    expect(usdc?.balanceBaseUnits).toBe("1500000000");
    const sol = hs.find((h) => h.asset === "SOL");
    expect(sol?.balanceBaseUnits).toBe("5000000000");
  });

  it("loadPortfolioView returns popup rows + allocation summary (cents-exact)", async () => {
    const v = await loadPortfolioView(stubClient(), ACCT, { nowMs: 1000 });
    // 2 ETH * $2000 = $4000; 5 SOL * $100 = $500; USDC price unknown -> stale, excluded
    expect(v.popup.totalUsd).toBe("4500.00");
    expect(v.summary.staleAssets).toContain("USDC@eip155:1");
    const ethAlloc = v.summary.allocation.find((a) => a.asset === "ETH");
    expect(ethAlloc?.pctBps).toBe(8888); // 4000/4500
  });

  it("failed reads degrade to zero balance / stale prices, never throw", async () => {
    const c = stubClient({
      getEvmBalance: async () => { throw new Error("rpc down"); },
      getPrices: async () => { throw new Error("price down"); },
    });
    const v = await loadPortfolioView(c, ACCT, { nowMs: 5 });
    expect(v.popup.totalUsd).toBe("0.00"); // all prices unknown -> excluded
    expect(v.summary.staleAssets).toContain("ETH@eip155:1");
    expect(v.summary.staleAssets).toContain("SOL@solana:mainnet");
  });
});

describe("gateway-models — activity", () => {
  it("maps gateway statuses to ActivityItem rows, spam hidden by default", async () => {
    const items = await loadActivity(
      stubClient(),
      [
        { chain: "eip155:1", txHash: `0x${"ab".repeat(32)}`, kind: "send", at: 100 },
        { chain: "solana:mainnet", txHash: "s".repeat(80), kind: "swap", at: 200 },
        { chain: "eip155:1", txHash: `0x${"cd".repeat(32)}`, kind: "receive", at: 300, hiddenAsSpam: true },
      ],
      defaultSettings(),
    );
    expect(items).toHaveLength(2); // spam hidden
    // visibleActivity sorts by `at` desc: solana (at 200) first, evm (at 100) second
    expect(items[0]?.chain).toBe("solana:mainnet");
    expect(items[0]?.status).toBe("pending");
    expect(items[1]?.chain).toBe("eip155:1");
    expect(items[1]?.status).toBe("confirmed");
    const all = await loadActivity(
      stubClient({ getSolTxStatus: async () => ({ stub: false, status: "failed", slot: 1, err: {} }) }),
      [{ chain: "solana:mainnet", txHash: "s".repeat(80), kind: "swap", at: 200 }],
      defaultSettings(),
    );
    expect(all[0]?.status).toBe("failed");
  });
});

describe("gateway-models — swap review", () => {
  it("builds review from gateway quote; blocks when quote missing", async () => {
    const vm = await loadSwapReview(
      stubClient(),
      { chain: "eip155:1", sellToken: "native", buyToken: "USDC", amountBaseUnits: "1000000000000000000", slippageBps: 50, recipient: ACCT.addresses["eip155:1"] },
      "0",
    );
    expect(vm.review.impactTier).toBe("ok");
    expect(vm.review.quote.buyAmountBaseUnits).toBe("2000000000");
    expect(vm.review.allowance.mode).toBe("exact");
    expect(vm.review.allowance.amountBaseUnits).toBe("0"); // native sell needs no allowance

    const noQuote = stubClient({ getSwapQuote: async () => ({ stub: true, quote: null }) });
    await expect(
      loadSwapReview(noQuote, { chain: "eip155:1", sellToken: "native", buyToken: "USDC", amountBaseUnits: "1", slippageBps: 50, recipient: "0x1" }, "0"),
    ).rejects.toThrow(/no live quote/);
  });
});

describe("gateway-models — recipient + client guard", () => {
  it("resolves names and validates addresses through features pipeline", async () => {
    const r = await resolveSendRecipient(
      "eip155:1",
      "vitalik.eth",
      { resolveName: async () => "0x1111111111111111111111111111111111111111", knownHistory: [] },
      (chain, addr) => chain.startsWith("eip155:") && /^0x[0-9a-fA-F]{40}$/.test(addr),
    );
    expect(r).toMatchObject({ ok: true, source: "ens" });
    const bad = await resolveSendRecipient("eip155:1", "0xzz", { resolveName: async () => null }, () => false);
    expect(bad).toMatchObject({ ok: false, code: "invalid-address" });
  });

  it("assertPortfolioGateway rejects incomplete clients", () => {
    expect(() => assertPortfolioGateway(stubClient())).not.toThrow();
    expect(() => assertPortfolioGateway({ getPrices: async () => ({}) })).toThrow(/missing/);
  });
});
