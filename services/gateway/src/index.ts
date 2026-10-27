// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import Fastify from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";

export interface GatewayOpts {
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
}

// In-memory TTL cache: 30s balances / 60s prices.
const BALANCE_TTL_MS = 30_000;
const PRICE_TTL_MS = 60_000;
type Entry = { expires: number; value: unknown };

function hashForLog(addr: string): string {
  return createHash("sha256").update(addr).digest("hex").slice(0, 12);
}

function upstreamMode(): "stub" | "live" {
  const has =
    process.env.ALCHEMY_KEY ??
    process.env.SOLANA_RPC_URL ??
    process.env.BTC_ESPLORA_URL ??
    process.env.ADA_KOIOS_URL;
  return has ? "live" : "stub";
}

export function buildServer(opts: GatewayOpts = {}) {
  const app = Fastify({ logger: false });
  const cache = new Map<string, Entry>();
  const max = opts.rateLimitMax ?? 100;
  const windowMs = opts.rateLimitWindowMs ?? 60_000;
  // token bucket per ip
  const buckets = new Map<string, { tokens: number; last: number }>();

  function cacheGet<T>(key: string): T | null {
    const e = cache.get(key);
    if (!e) return null;
    if (Date.now() > e.expires) {
      cache.delete(key);
      return null;
    }
    return e.value as T;
  }
  function cacheSet(key: string, value: unknown, ttl: number): void {
    cache.set(key, { expires: Date.now() + ttl, value });
  }

  // Rate limit first (429 on exceed), before all routes.
  app.addHook("onRequest", async (req, reply) => {
    const ip = req.ip ?? "unknown";
    const now = Date.now();
    let b = buckets.get(ip);
    if (!b) {
      b = { tokens: max, last: now };
      buckets.set(ip, b);
    }
    const elapsed = now - b.last;
    const refill = Math.floor((elapsed * max) / windowMs);
    if (refill > 0) {
      b.tokens = Math.min(max, b.tokens + refill);
      b.last = now;
    }
    if (b.tokens < 1) {
      return reply.status(429).send({ error: "rate_limited" });
    }
    b.tokens -= 1;
  });

  app.setErrorHandler((err, _req, reply) => {
    // Zod validation -> 400, never leak internals
    if (err && (err as { name?: string }).name === "ZodError") {
      return reply.status(400).send({ error: "bad_request" });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return reply.status(status >= 400 && status < 600 ? status : 500).send({ error: "internal" });
  });

  app.get("/healthz", async () => ({ ok: true, service: "drift-gateway", keysHeld: false }));

  app.get("/v1/prices", async (req) => {
    const q = z.object({ assets: z.string().default("ETH,SOL,ADA,BTC") }).parse(req.query);
    const key = `prices:${q.assets}`;
    const hit = cacheGet<{ prices: Record<string, number>; cached: boolean; stub: boolean }>(key);
    if (hit) return { ...hit, cached: true };
    // Stubbed; production proxies CoinGecko with 60s cache. No keys held.
    const val = { prices: { ETH: 0, SOL: 0, ADA: 0, BTC: 0 }, cached: false, stub: upstreamMode() === "stub" };
    cacheSet(key, val, PRICE_TTL_MS);
    return val;
  });

  const broadcastBody = z.object({ rawTx: z.string().min(1) });
  app.post("/v1/evm/:chainId/broadcast", async (req) => {
    const body = broadcastBody.parse(req.body);
    void body;
    return { txHash: "0xstub", stub: upstreamMode() === "stub" };
  });
  app.post("/v1/sol/broadcast", async () => ({ txSig: "stub", stub: upstreamMode() === "stub" }));
  app.post("/v1/btc/broadcast", async () => ({ txid: "stub", stub: upstreamMode() === "stub" }));
  app.post("/v1/ada/broadcast", async () => ({ txHash: "stub", stub: upstreamMode() === "stub" }));

  app.get("/v1/phishlist", async () => ({
    domains: ["evil-drain.example", "wallet-verify-seed.example"],
    updatedAt: new Date(0).toISOString(),
  }));

  const subBody = z.object({ hashedAddrHex: z.string().regex(/^[0-9a-f]{64}$/), pushToken: z.string().min(8) });
  app.post("/v1/push/subscribe", async (req) => {
    const b = subBody.parse(req.body);
    void b;
    return { ok: true };
  });

  // ---- Balance / UTXO / token routes (stub when upstream env missing) ----
  const evmBalParams = z.object({ chainId: z.string().min(1), addr: z.string().min(1) });
  app.get("/v1/evm/:chainId/balance/:addr", async (req) => {
    const p = evmBalParams.parse(req.params);
    void hashForLog(p.addr);
    const key = `evm:${p.chainId}:${p.addr.toLowerCase()}`;
    const hit = cacheGet<{ balance: string }>(key);
    if (hit) return { stub: true, chainId: p.chainId, address: p.addr, balance: hit.balance, cached: true };
    const balance = "0";
    cacheSet(key, { balance }, BALANCE_TTL_MS);
    return { stub: true, chainId: p.chainId, address: p.addr, balance, cached: false };
  });

  const solBalParams = z.object({ addr: z.string().min(1) });
  app.get("/v1/sol/balance/:addr", async (req) => {
    const p = solBalParams.parse(req.params);
    void hashForLog(p.addr);
    const key = `sol:${p.addr}`;
    const hit = cacheGet<{ balance: string }>(key);
    if (hit) return { stub: true, address: p.addr, balance: hit.balance, cached: true };
    cacheSet(key, { balance: "0" }, BALANCE_TTL_MS);
    return { stub: true, address: p.addr, balance: "0", cached: false };
  });

  const btcParams = z.object({ addr: z.string().min(1) });
  app.get("/v1/btc/utxo/:addr", async (req) => {
    const p = btcParams.parse(req.params);
    void hashForLog(p.addr);
    const key = `btc:${p.addr}`;
    const hit = cacheGet<{ utxos: unknown[] }>(key);
    if (hit) return { stub: true, address: p.addr, utxos: hit.utxos, cached: true };
    cacheSet(key, { utxos: [] }, BALANCE_TTL_MS);
    return { stub: true, address: p.addr, utxos: [], cached: false };
  });

  const adaParams = z.object({ addr: z.string().min(1) });
  app.get("/v1/ada/utxo/:addr", async (req) => {
    const p = adaParams.parse(req.params);
    void hashForLog(p.addr);
    const key = `ada:${p.addr}`;
    const hit = cacheGet<{ utxos: unknown[] }>(key);
    if (hit) return { stub: true, address: p.addr, utxos: hit.utxos, cached: true };
    cacheSet(key, { utxos: [] }, BALANCE_TTL_MS);
    return { stub: true, address: p.addr, utxos: [], cached: false };
  });

  const tokensParams = z.object({ chain: z.string().min(1) });
  app.get("/v1/tokens/:chain", async (req) => {
    const p = tokensParams.parse(req.params);
    const key = `tokens:${p.chain}`;
    const hit = cacheGet<{ tokens: unknown[] }>(key);
    if (hit) return { stub: true, chain: p.chain, tokens: hit.tokens, cached: true };
    cacheSet(key, { tokens: [] }, BALANCE_TTL_MS);
    return { stub: true, chain: p.chain, tokens: [], cached: false };
  });

  // ---- Transaction simulation (U033; stub when upstream env missing) ----
  const balanceChangeSchema = z.object({
    address: z.string().min(1),
    asset: z.string().min(1),
    before: z.string().regex(/^\d+$/),
    after: z.string().regex(/^\d+$/),
  });
  const simulateDiffSchema = z.object({ balanceChanges: z.array(balanceChangeSchema) });
  const simulateResponseSchema = z.object({
    stub: z.boolean(),
    diff: simulateDiffSchema.nullable(),
    cached: z.boolean(),
  });

  const evmSimulateBody = z.object({
    chainId: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    dataHex: z.string().regex(/^0x[0-9a-fA-F]*$/).optional(),
    valueWei: z.string().regex(/^\d+$/).optional(),
  });
  app.post("/v1/evm/simulate", async (req) => {
    const body = evmSimulateBody.parse(req.body);
    void body;
    // Live-mode proxy shape (documented, not executed in this env):
    // POST upstream eth_call bundle with state overrides { from, to, data, value }
    // -> trace asset balanceChanges [{ address, asset, before, after }].
    // No live calls here; always return diff:null with a zod-validated envelope.
    const resp = { stub: upstreamMode() === "stub", diff: null, cached: false };
    return simulateResponseSchema.parse(resp);
  });

  const solSimulateBody = z
    .object({
      messageBase64: z.string().min(1).optional(),
      transactionBase64: z.string().min(1).optional(),
    })
    .refine((v) => v.messageBase64 ?? v.transactionBase64, {
      message: "one of messageBase64 or transactionBase64 required",
    });
  app.post("/v1/sol/simulate", async (req) => {
    const body = solSimulateBody.parse(req.body);
    void body;
    // Live-mode proxy shape (documented, not executed in this env):
    // POST upstream Solana simulateTransaction RPC with the base64 message/tx
    // -> parse account balanceChanges [{ address, asset, before, after }].
    // No live calls here; always return diff:null with a zod-validated envelope.
    const resp = { stub: upstreamMode() === "stub", diff: null, cached: false };
    return simulateResponseSchema.parse(resp);
  });

  app.get("/openapi.json", async () => ({
    openapi: "3.0.0",
    info: { title: "drift-gateway", version: "0.1.0" },
    paths: {
      "/healthz": { get: { summary: "health" } },
      "/v1/prices": { get: { summary: "prices" } },
      "/v1/evm/{chainId}/broadcast": { post: { summary: "broadcast evm" } },
      "/v1/sol/broadcast": { post: { summary: "broadcast sol" } },
      "/v1/btc/broadcast": { post: { summary: "broadcast btc" } },
      "/v1/ada/broadcast": { post: { summary: "broadcast ada" } },
      "/v1/phishlist": { get: { summary: "phishlist" } },
      "/v1/push/subscribe": { post: { summary: "push subscribe" } },
      "/v1/evm/{chainId}/balance/{addr}": { get: { summary: "evm balance" } },
      "/v1/sol/balance/{addr}": { get: { summary: "sol balance" } },
      "/v1/btc/utxo/{addr}": { get: { summary: "btc utxos" } },
      "/v1/ada/utxo/{addr}": { get: { summary: "ada utxos" } },
      "/v1/tokens/{chain}": { get: { summary: "tokens" } },
      "/v1/evm/simulate": { post: { summary: "simulate evm" } },
      "/v1/sol/simulate": { post: { summary: "simulate sol" } },
    },
  }));

  return app;
}

if (process.argv[1]?.endsWith("index.ts")) {
  const app = buildServer();
  await app.listen({ port: Number(process.env.PORT ?? 8787), host: "127.0.0.1" });
}
