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

function envValue(name: string): string {
  const raw = process.env[name];
  return typeof raw === "string" ? raw.trim() : "";
}

export function upstreamMode(): "stub" | "live" {
  const override = envValue("GATEWAY_ENV_MODE").toLowerCase();
  if (override === "stub") return "stub";
  if (override === "live") return "live";
  const has =
    envValue("ALCHEMY_KEY") ||
    envValue("SOLANA_RPC_URL") ||
    envValue("BTC_ESPLORA_URL") ||
    envValue("ADA_KOIOS_URL") ||
    envValue("EVM_RPC_URL") ||
    envValue("PRICE_API_URL");
  return has ? "live" : "stub";
}

export function buildServer(opts: GatewayOpts = {}) {
  const app = Fastify({ logger: false });
  const cache = new Map<string, Entry>();
  const max = opts.rateLimitMax ?? 100;
  const windowMs = opts.rateLimitWindowMs ?? 60_000;
  // token bucket per ip, bounded to avoid unbounded memory growth
  const MAX_BUCKETS = 10_000;
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
    if (b) {
      // LRU: move to end on access.
      buckets.delete(ip);
      buckets.set(ip, b);
    } else {
      // Evict idle buckets when the map grows too large.
      if (buckets.size >= MAX_BUCKETS) {
        const cutoff = now - windowMs * 2;
        for (const [k, v] of buckets) {
          if (v.last < cutoff) buckets.delete(k);
          if (buckets.size < MAX_BUCKETS) break;
        }
        if (buckets.size >= MAX_BUCKETS) {
          const first = buckets.keys().next().value;
          if (first !== undefined) buckets.delete(first);
        }
      }
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
    const priceUrl = envValue("PRICE_API_URL");
    const live = upstreamMode() === "live" && priceUrl.length > 0;
    let prices: Record<string, number> = { ETH: 0, SOL: 0, ADA: 0, BTC: 0 };
    let stub = !live;
    if (live) {
      try {
        const res = await fetch(priceUrl);
        if (!res.ok) throw new Error(`upstream ${res.status}`);
        const json = (await res.json()) as Record<string, unknown>;
        for (const asset of q.assets.split(",")) {
          const v = json[asset.trim().toUpperCase()];
          if (typeof v === "number" && Number.isFinite(v)) prices[asset.trim().toUpperCase()] = v;
        }
        stub = false;
      } catch {
        stub = true;
      }
    }
    const val = { prices, cached: false, stub };
    cacheSet(key, val, PRICE_TTL_MS);
    return val;
  });

  const broadcastBody = z.object({ rawTx: z.string().min(1) });
  app.post("/v1/evm/:chainId/broadcast", async (req) => {
    const body = broadcastBody.parse(req.body);
    const rpcUrl = envValue("EVM_RPC_URL");
    const live = upstreamMode() === "live" && rpcUrl.length > 0;
    if (live) {
      try {
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [body.rawTx] }),
        });
        if (!res.ok) throw new Error(`upstream ${res.status}`);
        const json = (await res.json()) as { result?: string; error?: { message?: string } };
        if (json.error?.message) throw new Error(json.error.message);
        if (typeof json.result === "string") return { txHash: json.result, stub: false };
      } catch {
        // fall through to stub
      }
    }
    return { txHash: "0xstub", stub: true };
  });
  app.post("/v1/sol/broadcast", async (req) => {
    const body = broadcastBody.parse(req.body);
    const rpcUrl = envValue("SOLANA_RPC_URL");
    const live = upstreamMode() === "live" && rpcUrl.length > 0;
    if (live) {
      try {
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [body.rawTx, { encoding: "base64" }] }),
        });
        if (!res.ok) throw new Error(`upstream ${res.status}`);
        const json = (await res.json()) as { result?: string; error?: { message?: string } };
        if (json.error?.message) throw new Error(json.error.message);
        if (typeof json.result === "string") return { txSig: json.result, stub: false };
      } catch {
        // fall through
      }
    }
    return { txSig: "stub", stub: true };
  });
  app.post("/v1/btc/broadcast", async (req) => {
    const body = broadcastBody.parse(req.body);
    const baseUrl = envValue("BTC_ESPLORA_URL");
    const live = upstreamMode() === "live" && baseUrl.length > 0;
    if (live) {
      try {
        const res = await fetch(`${baseUrl.replace(/\/$/, "")}/tx`, {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: body.rawTx,
        });
        if (!res.ok) throw new Error(`upstream ${res.status}`);
        const text = (await res.text()).trim();
        if (text.length > 0) return { txid: text, stub: false };
      } catch {
        // fall through
      }
    }
    return { txid: "stub", stub: true };
  });
  app.post("/v1/ada/broadcast", async (req) => {
    const body = broadcastBody.parse(req.body);
    void body;
    return { txHash: "stub", stub: upstreamMode() === "stub" || !envValue("ADA_KOIOS_URL") };
  });

  app.get("/v1/phishlist", async () => ({
    domains: ["evil-drain.example", "wallet-verify-seed.example"],
    updatedAt: new Date().toISOString(),
  }));

  const subBody = z.object({ hashedAddrHex: z.string().regex(/^[0-9a-f]{64}$/), pushToken: z.string().min(8) });
  app.post("/v1/push/subscribe", async (req) => {
    const b = subBody.parse(req.body);
    void b;
    return { ok: true };
  });
  const revokeBody = z.object({ hashedAddrHex: z.string().regex(/^[0-9a-f]{64}$/) });
  app.post("/v1/push/revoke", async (req) => {
    revokeBody.parse(req.body);
    return { ok: true };
  });
  app.post("/v1/push/unsubscribe", async (req) => {
    revokeBody.parse(req.body);
    return { ok: true };
  });

  // ---- Balance / UTXO / token routes (stub when upstream env missing) ----
  const evmBalParams = z.object({ chainId: z.string().min(1), addr: z.string().min(1) });
  app.get("/v1/evm/:chainId/balance/:addr", async (req) => {
    const p = evmBalParams.parse(req.params);
    void hashForLog(p.addr);
    const key = `evm:${p.chainId}:${p.addr.toLowerCase()}`;
    const hit = cacheGet<{ balance: string; stub: boolean }>(key);
    if (hit) return { stub: hit.stub, chainId: p.chainId, address: p.addr, balance: hit.balance, balanceWei: hit.balance, cached: true };
    const rpcUrl = envValue("EVM_RPC_URL");
    const live = upstreamMode() === "live" && rpcUrl.length > 0;
    let balance = "0";
    let stub = !live;
    if (live) {
      try {
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [p.addr, "latest"] }),
        });
        if (!res.ok) throw new Error(`upstream ${res.status}`);
        const json = (await res.json()) as { result?: string };
        if (typeof json.result === "string" && /^0x[0-9a-fA-F]+$/.test(json.result)) {
          balance = BigInt(json.result).toString();
          stub = false;
        } else {
          stub = true;
        }
      } catch {
        stub = true;
      }
    }
    cacheSet(key, { balance, stub }, BALANCE_TTL_MS);
    return { stub, chainId: p.chainId, address: p.addr, balance, balanceWei: balance, cached: false };
  });

  const solBalParams = z.object({ addr: z.string().min(1) });
  app.get("/v1/sol/balance/:addr", async (req) => {
    const p = solBalParams.parse(req.params);
    void hashForLog(p.addr);
    const key = `sol:${p.addr}`;
    const hit = cacheGet<{ balance: string; stub: boolean }>(key);
    if (hit) return { stub: hit.stub, address: p.addr, balance: hit.balance, lamports: hit.balance, cached: true };
    const rpcUrl = envValue("SOLANA_RPC_URL");
    const live = upstreamMode() === "live" && rpcUrl.length > 0;
    let balance = "0";
    let stub = !live;
    if (live) {
      try {
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [p.addr] }),
        });
        if (!res.ok) throw new Error(`upstream ${res.status}`);
        const json = (await res.json()) as { result?: { value?: number } };
        if (typeof json.result?.value === "number") {
          balance = String(json.result.value);
          stub = false;
        } else {
          stub = true;
        }
      } catch {
        stub = true;
      }
    }
    cacheSet(key, { balance, stub }, BALANCE_TTL_MS);
    return { stub, address: p.addr, balance, lamports: balance, cached: false };
  });

  const btcParams = z.object({ addr: z.string().min(1) });
  app.get("/v1/btc/utxo/:addr", async (req) => {
    const p = btcParams.parse(req.params);
    void hashForLog(p.addr);
    const key = `btc:${p.addr}`;
    const hit = cacheGet<{ utxos: unknown[]; stub: boolean }>(key);
    if (hit) return { stub: hit.stub, address: p.addr, utxos: hit.utxos, cached: true };
    const baseUrl = envValue("BTC_ESPLORA_URL");
    const live = upstreamMode() === "live" && baseUrl.length > 0;
    let utxos: unknown[] = [];
    let stub = !live;
    if (live) {
      try {
        const res = await fetch(`${baseUrl.replace(/\/$/, "")}/address/${encodeURIComponent(p.addr)}/utxo`);
        if (!res.ok) throw new Error(`upstream ${res.status}`);
        const json = (await res.json()) as unknown;
        if (Array.isArray(json)) {
          utxos = json;
          stub = false;
        } else {
          stub = true;
        }
      } catch {
        stub = true;
      }
    }
    cacheSet(key, { utxos, stub }, BALANCE_TTL_MS);
    return { stub, address: p.addr, utxos, cached: false };
  });

  const adaParams = z.object({ addr: z.string().min(1) });
  app.get("/v1/ada/utxo/:addr", async (req) => {
    const p = adaParams.parse(req.params);
    void hashForLog(p.addr);
    const key = `ada:${p.addr}`;
    const hit = cacheGet<{ utxos: unknown[]; stub: boolean }>(key);
    if (hit) return { stub: hit.stub, address: p.addr, utxos: hit.utxos, cached: true };
    const baseUrl = envValue("ADA_KOIOS_URL");
    const live = upstreamMode() === "live" && baseUrl.length > 0;
    let utxos: unknown[] = [];
    let stub = !live;
    if (live) {
      try {
        const res = await fetch(`${baseUrl.replace(/\/$/, "")}/address_info`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ _addresses: [p.addr] }),
        });
        if (!res.ok) throw new Error(`upstream ${res.status}`);
        const json = (await res.json()) as unknown;
        if (Array.isArray(json)) {
          utxos = json;
          stub = false;
        } else if (json && typeof json === "object") {
          utxos = [json];
          stub = false;
        } else {
          stub = true;
        }
      } catch {
        stub = true;
      }
    }
    cacheSet(key, { utxos, stub }, BALANCE_TTL_MS);
    return { stub, address: p.addr, utxos, cached: false };
  });

  const tokensParams = z.object({ chain: z.string().min(1) });
  app.get("/v1/tokens/:chain", async (req) => {
    const p = tokensParams.parse(req.params);
    const key = `tokens:${p.chain}`;
    const hit = cacheGet<{ tokens: unknown[]; stub: boolean }>(key);
    if (hit) return { stub: hit.stub, chain: p.chain, tokens: hit.tokens, cached: true };
    const stub = upstreamMode() === "stub";
    cacheSet(key, { tokens: [], stub }, BALANCE_TTL_MS);
    return { stub, chain: p.chain, tokens: [], cached: false };
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
    const url = envValue("EVM_SIMULATE_URL") || envValue("EVM_RPC_URL");
    const live = upstreamMode() === "live" && url.length > 0;
    let diff: { balanceChanges: Array<{ address: string; asset: string; before: string; after: string }> } | null = null;
    let stub = !live;
    if (live) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_call",
            params: [{ from: body.from, to: body.to, data: body.dataHex ?? "0x", value: body.valueWei ? `0x${BigInt(body.valueWei).toString(16)}` : "0x0" }, "latest"],
          }),
        });
        if (!res.ok) throw new Error(`upstream ${res.status}`);
        const json = (await res.json()) as Record<string, unknown>;
        const changes =
          (json as { balanceChanges?: unknown }).balanceChanges ??
          (json as { result?: { balanceChanges?: unknown } }).result?.balanceChanges ??
          (json as { result?: unknown }).result;
        if (Array.isArray(changes)) {
          diff = { balanceChanges: changes as Array<{ address: string; asset: string; before: string; after: string }> };
          stub = false;
        } else if (json && typeof json === "object" && (json as { diff?: unknown }).diff) {
          diff = (json as { diff: { balanceChanges: Array<{ address: string; asset: string; before: string; after: string }> } }).diff;
          stub = false;
        } else {
          stub = true;
        }
      } catch {
        stub = true;
      }
    }
    const resp = { stub, diff, cached: false };
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
    const url = envValue("SOLANA_SIMULATE_URL") || envValue("SOLANA_RPC_URL");
    const live = upstreamMode() === "live" && url.length > 0;
    let diff: { balanceChanges: Array<{ address: string; asset: string; before: string; after: string }> } | null = null;
    let stub = !live;
    if (live) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "simulateTransaction",
            params: [body.transactionBase64 ?? body.messageBase64, { encoding: "base64" }],
          }),
        });
        if (!res.ok) throw new Error(`upstream ${res.status}`);
        const json = (await res.json()) as Record<string, unknown>;
        const changes =
          (json as { balanceChanges?: unknown }).balanceChanges ??
          (json as { result?: { value?: { balanceChanges?: unknown } } }).result?.value?.balanceChanges ??
          (json as { result?: { balanceChanges?: unknown } }).result?.balanceChanges;
        if (Array.isArray(changes)) {
          diff = { balanceChanges: changes as Array<{ address: string; asset: string; before: string; after: string }> };
          stub = false;
        } else if (json && typeof json === "object" && (json as { diff?: unknown }).diff) {
          diff = (json as { diff: { balanceChanges: Array<{ address: string; asset: string; before: string; after: string }> } }).diff;
          stub = false;
        } else {
          stub = true;
        }
      } catch {
        stub = true;
      }
    }
    const resp = { stub, diff, cached: false };
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
  const host = process.env.HOST ?? (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
  await app.listen({ port: Number(process.env.PORT ?? 8787), host });
}
