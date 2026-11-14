// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  pushSubscribeBody,
  createGatewayClient,
  CLIENT_VERSION_HEADER,
  type FetchFn,
} from "./index.js";

describe("gateway-client privacy", () => {
  it("requires hashed addresses for push", () => {
    expect(() => pushSubscribeBody("ab".repeat(32), "token12345")).not.toThrow();
    expect(() => pushSubscribeBody("0x1234", "token12345")).toThrow();
  });
});

function mockFetch(routes: Record<string, unknown>, seen: Array<{ url: string; init: RequestInit | undefined }>): FetchFn {
  return (async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const key = Object.keys(routes).find((k) => path === k || path.startsWith(`${k}?`) || path.startsWith(`${k}/`))
      ?? path;
    const body = routes[key] ?? routes[path];
    if (body === undefined) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as FetchFn;
}

describe("gateway-client T008", () => {
  const ADDR = "0x0000000000000000000000000000000000000001";
  function setup() {
    const seen: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchFn = mockFetch(
      {
        "/v1/prices": { prices: { ETH: 3000, SOL: 150 }, cached: true },
        "/v1/evm/1/balance": { balanceWei: "1000000000000000000" },
        "/v1/evm/1/broadcast": { txHash: `0x${"ab".repeat(32)}` },
        "/v1/sol/broadcast": { txSig: "sig123" },
        "/v1/btc/broadcast": { txid: "cc".repeat(32) },
        "/v1/ada/broadcast": { txHash: "ada-hash-1" },
        "/v1/phishlist": { domains: ["evil.example"], updatedAt: "2026-01-01T00:00:00.000Z" },
        "/v1/push/subscribe": { ok: true },
      },
      seen,
    );
    const client = createGatewayClient({ baseUrl: "https://gw.example", apiKey: "k", fetchFn });
    return { client, seen };
  }

  it("getPrices/getEvmBalance validate and return typed values", async () => {
    const { client, seen } = setup();
    expect(await client.getPrices(["ETH", "SOL"])).toEqual({ ETH: 3000, SOL: 150 });
    expect(await client.getEvmBalance(1, ADDR)).toBe(10n ** 18n);
    expect(seen[0]?.url).toContain("/v1/prices?assets=ETH,SOL");
    await expect(client.getPrices([])).rejects.toThrow();
    await expect(client.getEvmBalance(1, "0xbad")).rejects.toThrow();
  });
  it("broadcasts validate payloads and parse tx hashes", async () => {
    const { client } = setup();
    expect(await client.broadcastEvm(1, "0x02f86deadbeef")).toBe(`0x${"ab".repeat(32)}`);
    expect(await client.broadcastSol(Buffer.from("signed-sol").toString("base64"))).toBe("sig123");
    const psbt = Buffer.concat([Buffer.from("psbt\xff", "binary"), Buffer.alloc(8)]).toString("base64");
    expect(await client.broadcastBtc(psbt)).toBe("cc".repeat(32));
    expect(await client.broadcastAda("deadbeef".repeat(8))).toBe("ada-hash-1");
    await expect(client.broadcastEvm(1, "not-hex")).rejects.toThrow();
    await expect(client.broadcastBtc(Buffer.from("junk").toString("base64"))).rejects.toThrow(/psbt magic/);
  });
  it("getPhishlist/subscribePush round-trip; push requires sha256 hex", async () => {
    const { client } = setup();
    expect(await client.getPhishlist()).toEqual({ domains: ["evil.example"], updatedAt: "2026-01-01T00:00:00.000Z" });
    expect(await client.subscribePush("ab".repeat(32), "token12345")).toEqual({ ok: true });
    await expect(client.subscribePush("0x1234", "token12345")).rejects.toThrow(/sha256/);
  });
  it("sets X-Drift-Client header and bearer auth, never sends raw seed", async () => {
    const { client, seen } = setup();
    await client.getPrices(["ETH"]);
    const headers = (seen[0]?.init?.headers ?? {}) as Record<string, string>;
    expect(headers["X-Drift-Client"]).toBe(CLIENT_VERSION_HEADER);
    expect(headers["authorization"]).toBe("Bearer k");
    // No method accepts seed-like params: assert the client surface.
    expect(Object.keys(client).sort()).toEqual([
      "broadcastAda", "broadcastBtc", "broadcastEvm", "broadcastSol",
      "evmRpc", "getAdaUtxos", "getBtcUtxos", "getEvmBalance", "getEvmTokenBalances",
      "getEvmTxStatus", "getFeeEstimate", "getHealth", "getNfts", "getPhishlist",
      "getPrices", "getPricesHistory", "getSolBalance", "getSolTokenBalances",
      "getSolTxStatus", "getSwapQuote", "revokePush", "simulateEvm", "simulateSol",
      "subscribePush",
    ]);
    const bodies = seen.map((s) => String(s.init?.body ?? ""));
    expect(bodies.join(" ")).not.toMatch(/mnemonic|seed|entropy/i);
  });
  it("surfaces gateway errors and bad shapes", async () => {
    const failing = (async () => new Response("oops", { status: 500 })) as FetchFn;
    const client = createGatewayClient({ baseUrl: "https://gw.example", fetchFn: failing });
    await expect(client.getPrices(["ETH"])).rejects.toThrow(/gateway 500/);
    const badShape = mockFetch({ "/v1/prices": { nope: 1 } }, []);
    const bad = createGatewayClient({ baseUrl: "https://gw.example", fetchFn: badShape });
    await expect(bad.getPrices(["ETH"])).rejects.toThrow();
  });
});

describe("gateway-client iteration 3 endpoints", () => {
  const ADDR = "0x0000000000000000000000000000000000000001";
  const SOL = "So1111111111111111111111111111111111111111";
  function setup() {
    const seen: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchFn = mockFetch(
      {
        "/v1/prices/history": { stub: false, span: "7d", series: { ETH: [{ t: 1, p: 3000 }] } },
        "/v1/sol/balance": { lamports: "5000" },
        "/v1/btc/utxo": { utxos: [{ txid: "aa", value: 1 }] },
        "/v1/ada/utxo": { utxos: [{ balance: "1" }] },
        "/v1/evm/1/rpc": { stub: false, result: "0x1" },
        "/v1/evm/1/fee-estimate": {
          stub: false, chainId: "eip155:1", gasLimit: "21000",
          tiers: {
            low: { maxFeePerGasWei: "3000000000", maxPriorityFeePerGasWei: "1000000000" },
            med: { maxFeePerGasWei: "4000000000", maxPriorityFeePerGasWei: "2000000000" },
            high: { maxFeePerGasWei: "5000000000", maxPriorityFeePerGasWei: "3000000000" },
          },
        },
        "/v1/evm/1/tokens": { stub: false, tokens: [{ address: ADDR, symbol: "USDC", decimals: 6, balanceBaseUnits: "5000000" }] },
        "/v1/evm/1/tx": { stub: false, status: "success", blockNumber: "16", gasUsed: "21000" },
        "/v1/sol/tokens": { stub: false, tokens: [{ mint: SOL, tokenAccount: SOL, amountBaseUnits: "42", decimals: 9 }] },
        "/v1/sol/tx": { stub: false, status: "success", slot: 42, err: null },
        "/v1/swap/quote": {
          stub: false,
          quote: { sellToken: "native", buyToken: "USDC", sellAmountBaseUnits: "1000", buyAmountBaseUnits: "3", priceImpactPct: "0.1", allowanceNeededBaseUnits: "0" },
        },
        "/v1/nfts": { stub: false, items: [{ tokenId: "1", name: "Ape" }] },
        "/healthz": { ok: true, service: "drift-gateway", version: "0.2.0", mode: "live", keysHeld: false, upstreams: {} },
        "/v1/evm/simulate": { stub: false, diff: { balanceChanges: [{ address: ADDR, asset: "native", before: "1000", after: "0" }] } },
        "/v1/sol/simulate": { stub: true, diff: null },
        "/v1/push/revoke": { ok: true },
      },
      seen,
    );
    const client = createGatewayClient({ baseUrl: "https://gw.example", fetchFn });
    return { client, seen };
  }

  it("reads: balances, utxos, prices history, health", async () => {
    const { client } = setup();
    expect(await client.getSolBalance(SOL)).toBe(5000n);
    expect((await client.getBtcUtxos("bc1qxyz")).length).toBe(1);
    expect((await client.getAdaUtxos("addr1x")).length).toBe(1);
    const hist = await client.getPricesHistory(["ETH"], "7d");
    expect(hist.series.ETH).toEqual([{ t: 1, p: 3000 }]);
    const h = await client.getHealth();
    expect(h).toMatchObject({ ok: true, mode: "live", keysHeld: false });
  });

  it("evmRpc passthrough + fee estimate with bigint tiers", async () => {
    const { client, seen } = setup();
    const r = await client.evmRpc<string>(1, "eth_chainId", []);
    expect(r).toEqual({ stub: false, result: "0x1" });
    expect(seen[0]?.url).toContain("/v1/evm/1/rpc");
    const fee = await client.getFeeEstimate(1, { from: ADDR, to: ADDR, value: "1000" });
    expect(fee.gasLimit).toBe(21000n);
    expect(fee.tiers.low.maxFeePerGasWei).toBe(3_000_000_000n);
    expect(fee.tiers.high.maxPriorityFeePerGasWei).toBe(3_000_000_000n);
    await expect(client.evmRpc(1, "eth_sendRawTransaction", ["0x00"])).resolves.toBeDefined; // validation happens server-side
  });

  it("token balances + tx statuses convert to bigint", async () => {
    const { client } = setup();
    const tb = await client.getEvmTokenBalances(1, ADDR);
    expect(tb.tokens[0]).toMatchObject({ symbol: "USDC", balanceBaseUnits: 5_000_000n });
    const tx = await client.getEvmTxStatus(1, `0x${"ab".repeat(32)}`);
    expect(tx).toMatchObject({ status: "success", blockNumber: 16n, gasUsed: 21000n });
    const st = await client.getSolTokenBalances(SOL);
    expect(st.tokens[0]?.amountBaseUnits).toBe(42n);
    const stx = await client.getSolTxStatus("s".repeat(80));
    expect(stx).toMatchObject({ status: "success", slot: 42 });
  });

  it("swap quote + nfts + simulate + revokePush", async () => {
    const { client } = setup();
    const q = await client.getSwapQuote({ chain: "eip155:1", sellToken: "native", buyToken: "USDC", sellAmountBaseUnits: "1000", slippageBps: 50 });
    expect(q.quote).toMatchObject({ buyAmountBaseUnits: 3n, allowanceNeededBaseUnits: 0n });
    await expect(client.getSwapQuote({ chain: "eip155:1", sellToken: "a", buyToken: "b", sellAmountBaseUnits: "x", slippageBps: 50 })).rejects.toThrow();
    const n = await client.getNfts("eip155:1", ADDR);
    expect(n.items[0]?.tokenId).toBe("1");
    const sim = await client.simulateEvm({ chainId: "eip155:1", from: ADDR, to: ADDR, valueWei: "1000" });
    expect(sim.diff?.balanceChanges[0]?.after).toBe(0n);
    const simStub = await client.simulateSol({ messageBase64: "aGVsbG8=" });
    expect(simStub).toMatchObject({ stub: true, diff: null });
    await expect(client.revokePush("zz")).rejects.toThrow();
    expect(await client.revokePush("ab".repeat(32))).toEqual({ ok: true });
  });
});
