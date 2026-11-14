// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "./index.js";

describe("gateway (zero keys)", () => {
  it("healthz + phishlist + push privacy", async () => {
    const app = buildServer();
    const h = await app.inject({ method: "GET", url: "/healthz" });
    expect(h.json()).toMatchObject({ ok: true, keysHeld: false });
    const p = await app.inject({ method: "GET", url: "/v1/phishlist" });
    expect(p.json().domains.length).toBeGreaterThan(0);
    const bad = await app.inject({ method: "POST", url: "/v1/push/subscribe", payload: { hashedAddrHex: "0x123", pushToken: "tok12345" } });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });
  it("balances stub + cache TTL", async () => {
    const app = buildServer();
    const r1 = await app.inject({ method: "GET", url: "/v1/evm/eip155:1/balance/0xabc" });
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ stub: true, cached: false });
    const r2 = await app.inject({ method: "GET", url: "/v1/evm/eip155:1/balance/0xabc" });
    expect(r2.json()).toMatchObject({ stub: true, cached: true });
    const s = await app.inject({ method: "GET", url: "/v1/sol/balance/So111" });
    expect(s.json()).toMatchObject({ stub: true });
    const b = await app.inject({ method: "GET", url: "/v1/btc/utxo/bc1qtest" });
    expect(b.json()).toMatchObject({ stub: true });
    const a = await app.inject({ method: "GET", url: "/v1/ada/utxo/addr1test" });
    expect(a.json()).toMatchObject({ stub: true });
    const t = await app.inject({ method: "GET", url: "/v1/tokens/eip155:1" });
    expect(t.json()).toMatchObject({ stub: true });
    const pr1 = await app.inject({ method: "GET", url: "/v1/prices" });
    expect(pr1.statusCode).toBe(200);
    await app.close();
  });
  it("rate limits with 429", async () => {
    const app = buildServer({ rateLimitMax: 3, rateLimitWindowMs: 60_000 });
    for (let i = 0; i < 3; i++) {
      const r = await app.inject({ method: "GET", url: "/healthz" });
      expect(r.statusCode).toBe(200);
    }
    const limited = await app.inject({ method: "GET", url: "/healthz" });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: "rate_limited" });
    await app.close();
  });
  it("openapi lists routes", async () => {
    const app = buildServer();
    const r = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.openapi).toBe("3.0.0");
    expect(j.paths["/v1/evm/{chainId}/balance/{addr}"]).toBeDefined();
    expect(j.paths["/v1/sol/balance/{addr}"]).toBeDefined();
    await app.close();
  });
  it("simulate stub + zod validation", async () => {
    const app = buildServer();
    const evm = await app.inject({
      method: "POST",
      url: "/v1/evm/simulate",
      payload: { chainId: "eip155:1", from: "0xabc", to: "0xdef", valueWei: "1000" },
    });
    expect(evm.statusCode).toBe(200);
    expect(evm.json()).toMatchObject({ stub: true, diff: null, cached: false });
    const evmBad = await app.inject({
      method: "POST",
      url: "/v1/evm/simulate",
      payload: { chainId: "eip155:1", from: "0xabc" },
    });
    expect(evmBad.statusCode).toBe(400);
    const sol = await app.inject({
      method: "POST",
      url: "/v1/sol/simulate",
      payload: { messageBase64: "aGVsbG8=" },
    });
    expect(sol.statusCode).toBe(200);
    expect(sol.json()).toMatchObject({ stub: true, diff: null, cached: false });
    const solBad = await app.inject({ method: "POST", url: "/v1/sol/simulate", payload: {} });
    expect(solBad.statusCode).toBe(400);
    await app.close();
  });
  it("openapi lists simulate routes", async () => {
    const app = buildServer();
    const r = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(r.json().paths["/v1/evm/simulate"]).toBeDefined();
    expect(r.json().paths["/v1/sol/simulate"]).toBeDefined();
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// Iteration 3: live-upstream behavior against an in-process mock RPC/HTTP
// ---------------------------------------------------------------------------

import Fastify from "fastify";

const ENV_KEYS = [
  "GATEWAY_ENV_MODE", "EVM_RPC_URL", "PRICE_API_URL", "PRICE_HISTORY_URL",
  "SOLANA_RPC_URL", "BTC_ESPLORA_URL", "ADA_KOIOS_URL", "SWAP_0X_API_URL",
  "SWAP_JUPITER_API_URL", "ZEROX_API_KEY", "NFT_API_URL", "PHISHLIST_URL",
  "ALCHEMY_KEY", "EVM_SIMULATE_URL", "SOLANA_SIMULATE_URL",
];
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

type RpcHandler = (method: string, params: unknown[]) => unknown;
async function startMockRpc(handler: RpcHandler): Promise<{ url: string; close: () => Promise<void> }> {
  const mock = Fastify();
  mock.post("/", async (req) => {
    const b = req.body as { method: string; params: unknown[]; id: number };
    try {
      const result = handler(b.method, b.params);
      if (result instanceof Error) return { jsonrpc: "2.0", id: b.id, error: { message: result.message } };
      return { jsonrpc: "2.0", id: b.id, result };
    } catch (e) {
      return { jsonrpc: "2.0", id: b.id, error: { message: (e as Error).message } };
    }
  });
  await mock.listen({ port: 0, host: "127.0.0.1" });
  const addr = mock.server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  return { url: `http://127.0.0.1:${port}`, close: () => mock.close() };
}

type MockRoute = { method: "get" | "post"; path: string; handler: () => unknown };
async function startMockHttp(routes: MockRoute[]): Promise<{ url: string; close: () => Promise<void> }> {
  const mock = Fastify();
  // accept any content type (e.g. application/cbor for Koios submit)
  mock.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
  for (const r of routes) {
    const h = async (): Promise<unknown> => r.handler();
    if (r.method === "get") mock.get(r.path, h);
    else mock.post(r.path, h);
  }
  await mock.listen({ port: 0, host: "127.0.0.1" });
  const addr = mock.server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  return { url: `http://127.0.0.1:${port}`, close: () => mock.close() };
}

describe("gateway iteration 3 — live upstreams via mock", () => {
  it("empty-string env is treated as missing (F-P0-2 regression)", async () => {
    process.env.GATEWAY_ENV_MODE = "live";
    process.env.EVM_RPC_URL = "   ";
    const app = buildServer();
    const r = await app.inject({ method: "GET", url: "/v1/evm/eip155:1/balance/0xabc" });
    expect(r.json()).toMatchObject({ stub: true, balance: "0" });
    await app.close();
  });

  it("live EVM balance via per-chain RPC override + cache", async () => {
    const rpc = await startMockRpc((method) => {
      if (method === "eth_getBalance") return "0xde0b6b3a7640000";
      throw new Error(`unexpected ${method}`);
    });
    process.env.GATEWAY_ENV_MODE = "live";
    process.env.EVM_RPC_URL = "http://127.0.0.1:1/unused";
    process.env.EVM_RPC_URL_1 = rpc.url;
    const app = buildServer();
    const r1 = await app.inject({ method: "GET", url: "/v1/evm/eip155:1/balance/0xabc" });
    expect(r1.json()).toMatchObject({ stub: false, balance: "1000000000000000000", cached: false });
    const r2 = await app.inject({ method: "GET", url: "/v1/evm/eip155:1/balance/0xabc" });
    expect(r2.json()).toMatchObject({ stub: false, cached: true });
    const h = await app.inject({ method: "GET", url: "/healthz" });
    expect(h.json().upstreams["evm:eip155:1"].ok).toBe(true);
    expect(h.json().version).toBe("0.2.0");
    await app.close();
    await rpc.close();
  });

  it("RPC passthrough allowlist: eth_chainId live, eth_sendRawTransaction rejected", async () => {
    const rpc = await startMockRpc((method) => {
      if (method === "eth_chainId") return "0x1";
      throw new Error("nope");
    });
    process.env.GATEWAY_ENV_MODE = "live";
    process.env.EVM_RPC_URL_1 = rpc.url;
    const app = buildServer();
    const ok = await app.inject({ method: "POST", url: "/v1/evm/eip155:1/rpc", payload: { method: "eth_chainId", params: [] } });
    expect(ok.json()).toMatchObject({ stub: false, result: "0x1", cached: false });
    const cached = await app.inject({ method: "POST", url: "/v1/evm/eip155:1/rpc", payload: { method: "eth_chainId", params: [] } });
    expect(cached.json().cached).toBe(true);
    const bad = await app.inject({ method: "POST", url: "/v1/evm/eip155:1/rpc", payload: { method: "eth_sendRawTransaction", params: ["0x00"] } });
    expect(bad.statusCode).toBe(400);
    await app.close();
    await rpc.close();
  });

  it("fee-estimate returns gas limit + ordered tiers (feeHistory path)", async () => {
    const rpc = await startMockRpc((method, params) => {
      if (method === "eth_estimateGas") return "0x5208";
      if (method === "eth_feeHistory") return { baseFeePerGas: ["0x3b9aca00", "0x3b9aca00", "0x3b9aca00", "0x3b9aca00", "0x3b9aca00", "0x3b9aca00"], reward: [["0x1"], ["0x2"], ["0x3"]] };
      throw new Error(`unexpected ${method} ${JSON.stringify(params)}`);
    });
    process.env.GATEWAY_ENV_MODE = "live";
    process.env.EVM_RPC_URL_1 = rpc.url;
    const app = buildServer();
    const r = await app.inject({ method: "GET", url: "/v1/evm/eip155:1/fee-estimate?from=0xabc&to=0xdef&value=1000" });
    const j = r.json();
    expect(j.stub).toBe(false);
    expect(j.gasLimit).toBe("21000");
    const low = BigInt(j.tiers.low.maxFeePerGasWei);
    const med = BigInt(j.tiers.med.maxFeePerGasWei);
    const high = BigInt(j.tiers.high.maxFeePerGasWei);
    expect(low <= med && med <= high).toBe(true);
    await app.close();
    await rpc.close();
  });

  it("ERC-20 token balances parsed from eth_call (balanceOf/decimals/symbol)", async () => {
    const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48".toLowerCase();
    const rpc = await startMockRpc((method, params) => {
      if (method !== "eth_call") throw new Error("unexpected");
      const call = (params as { to: string; data: string }[])[0] as { to: string; data: string };
      expect(call.to.toLowerCase()).toBe(usdc);
      if (call.data.startsWith("0x70a08231")) return "0x" + (5_000_000n).toString(16).padStart(64, "0");
      if (call.data === "0x313ce567") return "0x" + (6n).toString(16).padStart(64, "0");
      if (call.data === "0x95d89b41") {
        const s = Buffer.from("USDC", "utf8");
        const len = (32n).toString(16).padStart(64, "0");
        const data = Buffer.concat([Buffer.from(len, "hex"), Buffer.concat([s, Buffer.alloc(32 - s.length)])]);
        return "0x" + data.toString("hex");
      }
      throw new Error("unexpected data");
    });
    process.env.GATEWAY_ENV_MODE = "live";
    process.env.EVM_RPC_URL_1 = rpc.url;
    const app = buildServer();
    const r = await app.inject({ method: "GET", url: "/v1/evm/eip155:1/tokens/0xabc?tokens=" + usdc });
    const j = r.json();
    expect(j.stub).toBe(false);
    expect(j.tokens).toHaveLength(1);
    expect(j.tokens[0]).toMatchObject({ symbol: "USDC", decimals: 6, balanceBaseUnits: "5000000" });
    await app.close();
    await rpc.close();
  });

  it("EVM tx status: receipt success and pending", async () => {
    const hash = "0x" + "ab".repeat(32);
    const rpc = await startMockRpc((method, params) => {
      if (method === "eth_getTransactionReceipt") {
        if ((params as string[])[0] === hash) return { status: "0x1", blockNumber: "0x10", gasUsed: "0x5208" };
        return null;
      }
      throw new Error("unexpected");
    });
    process.env.GATEWAY_ENV_MODE = "live";
    process.env.EVM_RPC_URL_1 = rpc.url;
    const app = buildServer();
    const ok = await app.inject({ method: "GET", url: `/v1/evm/eip155:1/tx/${hash}` });
    expect(ok.json()).toMatchObject({ stub: false, status: "success", blockNumber: "16", gasUsed: "21000" });
    const pend = await app.inject({ method: "GET", url: `/v1/evm/eip155:1/tx/0x${"cd".repeat(32)}` });
    expect(pend.json()).toMatchObject({ stub: false, status: "pending" });
    await app.close();
    await rpc.close();
  });

  it("SPL token accounts parsed (mint base58, amount, decimals)", async () => {
    const mintBytes = Buffer.alloc(32, 7);
    const acc = Buffer.alloc(165);
    mintBytes.copy(acc, 0);
    acc.writeBigUInt64LE(123_456_789n, 64);
    const mintAcc = Buffer.alloc(82);
    mintAcc.writeUInt8(6, 44); // decimals
    const rpc = await startMockRpc((method, params) => {
      if (method === "getTokenAccountsByOwner") {
        return { value: [{ pubkey: "TokenAcct1111111111111111111111111111111111", account: { data: [acc.toString("base64"), "base64"] } }] };
      }
      if (method === "getMultipleAccounts") {
        void params;
        return { value: [{ data: [mintAcc.toString("base64"), "base64"] }] };
      }
      throw new Error(`unexpected ${method}`);
    });
    process.env.GATEWAY_ENV_MODE = "live";
    process.env.SOLANA_RPC_URL = rpc.url;
    const app = buildServer();
    const r = await app.inject({ method: "GET", url: "/v1/sol/tokens/So1111111111111111111111111111111111111111" });
    const j = r.json();
    expect(j.stub).toBe(false);
    expect(j.tokens).toHaveLength(1);
    expect(j.tokens[0].amountBaseUnits).toBe("123456789");
    expect(j.tokens[0].decimals).toBe(6);
    expect(typeof j.tokens[0].mint).toBe("string");
    expect(j.tokens[0].mint.length).toBeGreaterThanOrEqual(32);
    await app.close();
    await rpc.close();
  });

  it("Solana signature status maps to success/failed/pending", async () => {
    const sig = "s".repeat(80);
    const rpc = await startMockRpc((method, params) => {
      if (method === "getSignatureStatuses") {
        const arr = (params as string[][])[0] as string[];
        if (arr[0] === sig) return { value: [{ slot: 42, err: null, confirmationStatus: "confirmed" }] };
        if (arr[0] === "f".repeat(80)) return { value: [{ slot: 43, err: { InstructionError: [] } }] };
        return { value: [null] };
      }
      throw new Error("unexpected");
    });
    process.env.GATEWAY_ENV_MODE = "live";
    process.env.SOLANA_RPC_URL = rpc.url;
    const app = buildServer();
    const ok = await app.inject({ method: "GET", url: `/v1/sol/tx/${sig}` });
    expect(ok.json()).toMatchObject({ stub: false, status: "success", slot: 42 });
    const fail = await app.inject({ method: "GET", url: `/v1/sol/tx/${"f".repeat(80)}` });
    expect(fail.json().status).toBe("failed");
    const pend = await app.inject({ method: "GET", url: `/v1/sol/tx/${"p".repeat(80)}` });
    expect(pend.json().status).toBe("pending");
    await app.close();
    await rpc.close();
  });

  it("swap quote proxy normalizes 0x (EVM) with allowance for ERC-20, none for native", async () => {
    const zeroX = await startMockHttp([
      {
        method: "get",
        path: "/swap/v1/quote",
        handler: () => ({ buyAmount: "990000", estimatedPriceImpact: "0.42", to: "0xrouter", allowanceTarget: "0xspender" }),
      },
    ]);
    process.env.GATEWAY_ENV_MODE = "live";
    process.env.SWAP_0X_API_URL = zeroX.url;
    const app = buildServer();
    const erc20 = await app.inject({
      method: "POST",
      url: "/v1/swap/quote",
      payload: { chain: "eip155:1", sellToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", buyToken: "native", sellAmountBaseUnits: "1000000", slippageBps: 50 },
    });
    const q = erc20.json();
    expect(q.stub).toBe(false);
    expect(q.quote).toMatchObject({ buyAmountBaseUnits: "990000", priceImpactPct: "0.42", allowanceNeededBaseUnits: "1000000" });
    const native = await app.inject({
      method: "POST",
      url: "/v1/swap/quote",
      payload: { chain: "eip155:1", sellToken: "native", buyToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", sellAmountBaseUnits: "1000", slippageBps: 50 },
    });
    expect(native.json().quote.allowanceNeededBaseUnits).toBe("0");
    const badChain = await app.inject({
      method: "POST",
      url: "/v1/swap/quote",
      payload: { chain: "bip122:xyz", sellToken: "a", buyToken: "b", sellAmountBaseUnits: "1", slippageBps: 50 },
    });
    expect(badChain.statusCode).toBe(400);
    await app.close();
    await zeroX.close();
  });

  it("swap quote proxy normalizes Jupiter (Solana)", async () => {
    const jup = await startMockHttp([
      { method: "get", path: "/quote", handler: () => ({ outAmount: "777", priceImpactPct: 1.25, routePlan: [{ swapInfo: {} }] }) },
    ]);
    process.env.GATEWAY_ENV_MODE = "live";
    process.env.SWAP_JUPITER_API_URL = jup.url;
    const app = buildServer();
    const r = await app.inject({
      method: "POST",
      url: "/v1/swap/quote",
      payload: { chain: "solana:mainnet", sellToken: "SOL", buyToken: "So11111111111111111111111111111111111111112", sellAmountBaseUnits: "1000000000", slippageBps: 100 },
    });
    const q = r.json();
    expect(q.stub).toBe(false);
    expect(q.quote).toMatchObject({ buyAmountBaseUnits: "777", priceImpactPct: "1.25" });
    await app.close();
    await jup.close();
  });

  it("prices + history live via mock price API; phishlist dynamic", async () => {
    const api = await startMockHttp([
      { method: "get", path: "/", handler: () => ({ ETH: 3200.5, SOL: 150 }) },
      { method: "get", path: "/history", handler: () => ({ series: { ETH: [{ t: 1, p: 3100 }, { t: 2, p: 3200.5 }] } }) },
      { method: "get", path: "/phish", handler: () => ({ domains: ["scam.example"], updatedAt: "2026-01-01T00:00:00Z" }) },
    ]);
    process.env.GATEWAY_ENV_MODE = "live";
    process.env.PRICE_API_URL = api.url;
    process.env.PRICE_HISTORY_URL = `${api.url}/history`;
    process.env.PHISHLIST_URL = `${api.url}/phish`;
    const app = buildServer();
    const pr = await app.inject({ method: "GET", url: "/v1/prices?assets=ETH,SOL" });
    expect(pr.json()).toMatchObject({ stub: false, prices: { ETH: 3200.5, SOL: 150 } });
    const hist = await app.inject({ method: "GET", url: "/v1/prices/history?assets=ETH&span=7d" });
    expect(hist.json().stub).toBe(false);
    expect(hist.json().series.ETH).toHaveLength(2);
    const pl = await app.inject({ method: "GET", url: "/v1/phishlist" });
    expect(pl.json().domains).toEqual(["scam.example"]);
    await app.close();
    await api.close();
  });

  it("NFT index via URL template; ada/btc broadcast via mock HTTP", async () => {
    const nft = await startMockHttp([
      { method: "get", path: "/nfts/eip155:1/0xabc", handler: () => ({ items: [{ contract: "0xbc4", tokenId: "1", name: "Ape #1" }] }) },
    ]);
    const koios = await startMockHttp([
      { method: "post", path: "/submit/tx", handler: () => "ab".repeat(32) },
    ]);
    const esplora = await startMockHttp([
      { method: "post", path: "/tx", handler: () => "cd".repeat(32) },
      { method: "get", path: "/address/bc1qxyz/utxo", handler: () => [{ txid: "aa".repeat(32), vout: 0, value: 5000 }] },
    ]);
    process.env.GATEWAY_ENV_MODE = "live";
    process.env.NFT_API_URL = `${nft.url}/nfts/{chain}/{addr}`;
    process.env.ADA_KOIOS_URL = koios.url;
    process.env.BTC_ESPLORA_URL = esplora.url;
    const app = buildServer();
    const n = await app.inject({ method: "GET", url: "/v1/nfts/eip155:1/0xabc" });
    expect(n.json()).toMatchObject({ stub: false, items: [{ tokenId: "1", name: "Ape #1" }] });
    const ada = await app.inject({ method: "POST", url: "/v1/ada/broadcast", payload: { rawTx: "84a10081825820" + "00".repeat(40) } });
    expect(ada.json()).toMatchObject({ stub: false, txHash: "ab".repeat(32) });
    const btc = await app.inject({ method: "POST", url: "/v1/btc/broadcast", payload: { rawTx: "deadbeef" } });
    expect(btc.json()).toMatchObject({ stub: false, txid: "cd".repeat(32) });
    const utxo = await app.inject({ method: "GET", url: "/v1/btc/utxo/bc1qxyz" });
    expect(utxo.json().stub).toBe(false);
    expect(utxo.json().utxos[0].value).toBe(5000);
    await app.close();
    await nft.close();
    await koios.close();
    await esplora.close();
  });

  it("cache is bounded (LRU max entries enforced)", async () => {
    const app = buildServer({ cacheMaxEntries: 5 });
    for (let i = 0; i < 12; i++) {
      await app.inject({ method: "GET", url: `/v1/evm/eip155:1/balance/0x${String(i).padStart(3, "0")}` });
    }
    const h = await app.inject({ method: "GET", url: "/healthz" });
    expect(h.json().cacheSize).toBeLessThanOrEqual(5);
    await app.close();
  });

  it("openapi.json is generated from the route registry and lists new routes", async () => {
    const app = buildServer();
    const r = await app.inject({ method: "GET", url: "/openapi.json" });
    const paths = r.json().paths;
    for (const p of [
      "/v1/evm/{chainId}/rpc", "/v1/evm/{chainId}/fee-estimate", "/v1/evm/{chainId}/tokens/{addr}",
      "/v1/evm/{chainId}/tx/{hash}", "/v1/sol/tokens/{addr}", "/v1/sol/tx/{sig}",
      "/v1/prices/history", "/v1/swap/quote", "/v1/nfts/{chain}/{addr}", "/healthz",
    ]) {
      expect(paths[p], p).toBeDefined();
    }
    await app.close();
  });
});
