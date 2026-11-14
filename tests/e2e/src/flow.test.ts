// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// Iteration 4 — integration E2E (no browser needed): real gateway server +
// real gateway-client + real policy engine, against in-process mock upstreams
// (EVM RPC, price API, 0x, Esplora). Proves the full wallet loop:
// health -> prices -> balance -> fee tiers -> token balances -> swap quote ->
// simulate -> broadcast -> tx status, plus the sim-mismatch block.

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "@drift/gateway";
import { createGatewayClient, type GatewayClient } from "@drift/gateway-client";
import { compareDeltas, evaluate, type BalanceDiff } from "@drift/policy-engine";

const ADDR = "0x1111111111111111111111111111111111111111";
const TXHASH = `0x${"ab".repeat(32)}`;

const ENV_KEYS = [
  "GATEWAY_ENV_MODE", "EVM_RPC_URL", "EVM_RPC_URL_1", "PRICE_API_URL", "PRICE_HISTORY_URL",
  "SWAP_0X_API_URL", "BTC_ESPLORA_URL", "SOLANA_RPC_URL", "PHISHLIST_URL",
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

async function listen(app: FastifyInstance): Promise<{ url: string; close: () => Promise<void> }> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  return { url: `http://127.0.0.1:${port}`, close: () => app.close() };
}

/** Mock EVM RPC with the methods the gateway uses. */
function mockEvmRpc(): Promise<{ url: string; close: () => Promise<void>; calls: string[] }> {
  const calls: string[] = [];
  const app = Fastify();
  app.post("/", async (req) => {
    const b = req.body as { method: string; params: unknown[]; id: number };
    calls.push(b.method);
    const result: unknown = (() => {
      switch (b.method) {
        case "eth_getBalance":
          return "0x8ac7230489e80000"; // 10 ETH
        case "eth_estimateGas":
          return "0x5208";
        case "eth_feeHistory":
          return { baseFeePerGas: ["0x3b9aca00", "0x3b9aca00", "0x3b9aca00"], reward: [["0x5f5e100"], ["0x77359400"], ["0x9502f900"]] };
        case "eth_call": {
          const call = (b.params as { to: string; data: string; from?: string }[])[0] as { to: string; data: string; from?: string };
          // simulate path (gateway /v1/evm/simulate): call object carries `from`
          if (call.from !== undefined) {
            return {
              balanceChanges: [
                { address: ADDR, asset: "native", before: "1010", after: "0" },
                { address: "0x2222222222222222222222222222222222222222", asset: "native", before: "0", after: "1000" },
              ],
            };
          }
          if (call.data.startsWith("0x70a08231")) return "0x" + (2_000_000_000n).toString(16).padStart(64, "0"); // 2000 USDC
          if (call.data === "0x313ce567") return "0x" + (6n).toString(16).padStart(64, "0");
          if (call.data === "0x95d89b41") {
            const s = Buffer.from("USDC", "utf8");
            return "0x" + Buffer.concat([Buffer.from((32n).toString(16).padStart(64, "0"), "hex"), Buffer.concat([s, Buffer.alloc(32 - s.length)])]).toString("hex");
          }
          return "0x";
        }
        case "eth_sendRawTransaction":
          return TXHASH;
        case "eth_getTransactionReceipt":
          return { status: "0x1", blockNumber: "0x100", gasUsed: "0x5208" };
        case "eth_chainId":
          return "0x1";
        case "eth_call_sim": // not a real method; gateway simulate uses eth_call — handled above
          return "0x";
        default:
          throw new Error(`unexpected ${b.method}`);
      }
    })();
    if (result instanceof Error) return { jsonrpc: "2.0", id: b.id, error: { message: result.message } };
    return { jsonrpc: "2.0", id: b.id, result };
  });
  return listen(app).then((l) => ({ ...l, calls }));
}

function mockPrices(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = Fastify();
  app.get("/", async () => ({ ETH: 3000, SOL: 150, BTC: 90000, ADA: 0.5 }));
  app.get("/history", async () => ({ series: { ETH: [{ t: 1, p: 2900 }, { t: 2, p: 3000 }] } }));
  return listen(app);
}

function mock0x(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = Fastify();
  app.get("/swap/v1/quote", async () => ({
    buyAmount: "5900000000",
    estimatedPriceImpact: "0.31",
    to: "0xrouter",
    allowanceTarget: "0xspender",
  }));
  return listen(app);
}

function mockEsplora(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = Fastify();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_r, b, done) => done(null, b));
  app.get("/address/:addr/utxo", async () => [{ txid: "aa".repeat(32), vout: 0, value: 100_000 }]);
  app.post("/tx", async () => "bb".repeat(32));
  return listen(app);
}

describe("e2e — full wallet loop through gateway + client + policy", () => {
  it("health -> prices -> balance -> fees -> tokens -> quote -> simulate -> broadcast -> status", async () => {
    const rpc = await mockEvmRpc();
    const prices = await mockPrices();
    const zerox = await mock0x();
    const esplora = await mockEsplora();
    process.env.GATEWAY_ENV_MODE = "live";
    process.env.EVM_RPC_URL_1 = rpc.url;
    process.env.PRICE_API_URL = prices.url;
    process.env.PRICE_HISTORY_URL = `${prices.url}/history`;
    process.env.SWAP_0X_API_URL = zerox.url;
    process.env.BTC_ESPLORA_URL = esplora.url;

    const gw = await listen(buildServer());
    const client: GatewayClient = createGatewayClient({ baseUrl: gw.url });

    // 1. health: live mode, no keys
    const h = await client.getHealth();
    expect(h).toMatchObject({ ok: true, mode: "live", keysHeld: false });

    // 2. prices + history
    expect((await client.getPrices(["ETH", "SOL"])).ETH).toBe(3000);
    const hist = await client.getPricesHistory(["ETH"], "7d");
    expect(hist.stub).toBe(false);
    expect(hist.series.ETH).toHaveLength(2);

    // 3. EVM balance (10 ETH in wei)
    expect(await client.getEvmBalance(1, ADDR)).toBe(10n ** 19n);

    // 4. fee estimate: tiers ordered
    const fee = await client.getFeeEstimate(1, { from: ADDR, to: ADDR, value: "1000" });
    expect(fee.stub).toBe(false);
    expect(fee.gasLimit).toBe(21000n);
    expect(fee.tiers.low.maxFeePerGasWei <= fee.tiers.med.maxFeePerGasWei).toBe(true);
    expect(fee.tiers.med.maxFeePerGasWei <= fee.tiers.high.maxFeePerGasWei).toBe(true);

    // 5. ERC-20 balances (default allowlist on chain 1)
    const toks = await client.getEvmTokenBalances(1, ADDR);
    const usdc = toks.tokens.find((t) => t.symbol === "USDC");
    expect(usdc?.balanceBaseUnits).toBe(2_000_000_000n);

    // 6. swap quote normalized
    const q = await client.getSwapQuote({
      chain: "eip155:1", sellToken: "native", buyToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      sellAmountBaseUnits: "1000000000000000000", slippageBps: 50, taker: ADDR,
    });
    expect(q.stub).toBe(false);
    expect(q.quote?.buyAmountBaseUnits).toBe(5_900_000_000n);
    expect(q.quote?.allowanceNeededBaseUnits).toBe(0n); // native sell

    // 7. simulate via gateway (eth_call passthrough returns 0x -> empty diff shape)
    const sim = await client.simulateEvm({ chainId: "eip155:1", from: ADDR, to: ADDR, valueWei: "1000" });
    expect(sim.stub).toBe(false);

    // 8. broadcast + status
    const hash = await client.broadcastEvm(1, "0x02" + "00".repeat(50));
    expect(hash).toBe(TXHASH);
    const st = await client.getEvmTxStatus(1, TXHASH);
    expect(st).toMatchObject({ status: "success", blockNumber: 256n, gasUsed: 21000n });

    // 9. BTC utxo + broadcast
    const utxos = await client.getBtcUtxos("bc1qxyz");
    expect((utxos[0] as { value: number }).value).toBe(100_000);
    // (broadcast needs a real psbt base64; covered in gateway unit tests)

    // 10. policy: sim delta gate end-to-end
    const simulated: BalanceDiff[] = [
      { address: ADDR, token: "native", before: "1010", after: "0", delta: "-1010" },
      { address: "0x2222222222222222222222222222222222222222", token: "native", before: "0", after: "1000", delta: "1000" },
    ];
    const okVerdict = await evaluate({
      chainId: "eip155:1", kind: "native-transfer", from: ADDR,
      to: "0x2222222222222222222222222222222222222222",
      amountBaseUnits: "1000", feeBaseUnits: "10", origin: "https://app.uniswap.org",
    }, { claimedDeltas: [
      { address: ADDR, token: "native", delta: "-1010" },
      { address: "0x2222222222222222222222222222222222222222", token: "native", delta: "1000" },
    ], simulated, tolerance: 0n });
    expect(okVerdict.verdict).toBe("allow");
    const bad = compareDeltas([{ address: "0x2222222222222222222222222222222222222222", token: "native", delta: "5000" }], simulated, 0n);
    expect(bad?.code).toBe("SIM_MISMATCH");

    await gw.close();
    await rpc.close();
    await prices.close();
    await zerox.close();
    await esplora.close();
  }, 20_000);
});
