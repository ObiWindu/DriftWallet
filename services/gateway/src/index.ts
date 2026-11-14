// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import Fastify, { type FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";

export interface GatewayOpts {
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
  cacheMaxEntries?: number;
}

const VERSION = "0.2.0";

// Cache TTLs: balances 30s / prices 60s / history 5m / phishlist 6h.
const BALANCE_TTL_MS = 30_000;
const PRICE_TTL_MS = 60_000;
const HISTORY_TTL_MS = 5 * 60_000;
const PHISHLIST_TTL_MS = 6 * 60 * 60_000;
const NFT_TTL_MS = 60_000;
const RPC_ID_CACHE_MS = 60_000;
const RPC_TIMEOUT_MS = 10_000;

function hashForLog(addr: string): string {
  return createHash("sha256").update(addr).digest("hex").slice(0, 12);
}

/** Env read that treats unset AND empty/whitespace as missing (F-P0-2). */
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

// ---------------------------------------------------------------------------
// Bounded LRU + TTL cache (F-P0-10: no unbounded growth for any cache)
// ---------------------------------------------------------------------------

class LruTtlCache {
  private map = new Map<string, { expires: number; value: unknown }>();
  constructor(private max: number) {}
  get<T>(key: string): T | null {
    const e = this.map.get(key);
    if (!e) return null;
    if (Date.now() > e.expires) {
      this.map.delete(key);
      return null;
    }
    // LRU touch
    this.map.delete(key);
    this.map.set(key, e);
    return e.value as T;
  }
  set(key: string, value: unknown, ttl: number): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { expires: Date.now() + ttl, value });
    while (this.map.size > this.max) {
      const first = this.map.keys().next().value;
      if (first === undefined) break;
      this.map.delete(first);
    }
  }
  get size(): number {
    return this.map.size;
  }
}

// ---------------------------------------------------------------------------
// Upstream health tracking (surfaced on /healthz; never includes secrets)
// ---------------------------------------------------------------------------

interface UpstreamState {
  ok: boolean;
  at: number;
  detail?: string | undefined;
}

const upstreams = new Map<string, UpstreamState>();
function markUpstream(name: string, ok: boolean, detail?: string): void {
  upstreams.set(name, { ok, at: Date.now(), detail: detail?.slice(0, 120) });
}

// ---------------------------------------------------------------------------
// JSON-RPC helper with timeout; throws Error on RPC-level errors
// ---------------------------------------------------------------------------

async function rpcCall<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`upstream http ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error?.message) throw new Error(json.error.message);
  return json.result as T;
}

/** Parse "eip155:1" or "1" -> 1. Returns null when unparseable. */
function evmChainNum(chainParam: string): number | null {
  const m = /^(?:eip155:)?(\d+)$/.exec(chainParam.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Per-chain RPC override: EVM_RPC_URL_<CHAIN_ID> falls back to EVM_RPC_URL. */
function evmRpcUrl(chainParam: string): string {
  const n = evmChainNum(chainParam);
  if (n !== null) {
    const per = envValue(`EVM_RPC_URL_${n}`);
    if (per) return per;
  }
  return envValue("EVM_RPC_URL");
}

// ---------------------------------------------------------------------------
// Minimal base58 encoder (SPL mint pubkeys) — no extra deps in the gateway
// ---------------------------------------------------------------------------

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Encode(bytes: Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += (digits[i] ?? 0) << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (const byte of bytes) {
    if (byte === 0) out += "1";
    else break;
  }
  return out + digits.reverse().map((d) => B58[d]).join("");
}

// ---------------------------------------------------------------------------
// Route registry — /openapi.json is generated from this (F-P1-4)
// ---------------------------------------------------------------------------

type RouteSpec = { method: "get" | "post"; path: string; summary: string };

export function buildServer(opts: GatewayOpts = {}) {
  const app = Fastify({ logger: false });
  const cache = new LruTtlCache(opts.cacheMaxEntries ?? 2_000);
  const routeSpecs: RouteSpec[] = [];
  const reg = (method: "get" | "post", path: string, summary: string): void => {
    routeSpecs.push({ method, path, summary });
  };
  const max = opts.rateLimitMax ?? 100;
  const windowMs = opts.rateLimitWindowMs ?? 60_000;
  // token bucket per ip, bounded to avoid unbounded memory growth
  const MAX_BUCKETS = 10_000;
  const buckets = new Map<string, { tokens: number; last: number }>();

  // Rate limit first (429 on exceed), before all routes.
  app.addHook("onRequest", async (req, reply) => {
    const ip = req.ip ?? "unknown";
    const now = Date.now();
    let b = buckets.get(ip);
    if (b) {
      buckets.delete(ip);
      buckets.set(ip, b);
    } else {
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
    if (err && (err as { name?: string }).name === "ZodError") {
      return reply.status(400).send({ error: "bad_request" });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return reply.status(status >= 400 && status < 600 ? status : 500).send({ error: "internal" });
  });

  // ---- health: version + per-upstream status, never any key material ----
  reg("get", "/healthz", "health + upstream status");
  app.get("/healthz", async () => ({
    ok: true,
    service: "drift-gateway",
    version: VERSION,
    mode: upstreamMode(),
    keysHeld: false,
    upstreams: Object.fromEntries(upstreams),
    cacheSize: cache.size,
  }));

  // ---- prices ----
  reg("get", "/v1/prices", "current fiat prices (USD) per asset");
  app.get("/v1/prices", async (req) => {
    const q = z.object({ assets: z.string().default("ETH,SOL,ADA,BTC") }).parse(req.query);
    const key = `prices:${q.assets}`;
    const hit = cache.get<{ prices: Record<string, number>; cached: boolean; stub: boolean }>(key);
    if (hit) return { ...hit, cached: true };
    const priceUrl = envValue("PRICE_API_URL");
    const live = upstreamMode() === "live" && priceUrl.length > 0;
    const prices: Record<string, number> = {};
    let stub = !live;
    if (live) {
      try {
        const res = await fetch(priceUrl, { signal: AbortSignal.timeout(RPC_TIMEOUT_MS) });
        if (!res.ok) throw new Error(`upstream ${res.status}`);
        const json = (await res.json()) as Record<string, unknown>;
        for (const asset of q.assets.split(",")) {
          const v = json[asset.trim().toUpperCase()];
          if (typeof v === "number" && Number.isFinite(v)) prices[asset.trim().toUpperCase()] = v;
        }
        stub = false;
        markUpstream("prices", true);
      } catch (e) {
        stub = true;
        markUpstream("prices", false, (e as Error).message);
      }
    }
    const val = { prices, cached: false, stub };
    cache.set(key, val, PRICE_TTL_MS);
    return val;
  });

  // ---- price history (sparklines) ----
  const historyQuery = z.object({
    assets: z.string().default("ETH,SOL,ADA,BTC"),
    span: z.enum(["1d", "7d", "30d", "1y"]).default("7d"),
  });
  const historySeriesSchema = z.record(
    z.string(),
    z.array(z.object({ t: z.number(), p: z.number().finite().nonnegative() })),
  );
  reg("get", "/v1/prices/history", "price history series for sparklines");
  app.get("/v1/prices/history", async (req) => {
    const q = historyQuery.parse(req.query);
    const key = `hist:${q.span}:${q.assets}`;
    const hit = cache.get<{ stub: boolean; span: string; series: Record<string, { t: number; p: number }[]>; cached: boolean }>(key);
    if (hit) return { ...hit, cached: true };
    const base = envValue("PRICE_HISTORY_URL") || (envValue("PRICE_API_URL") ? `${envValue("PRICE_API_URL").replace(/\/$/, "")}/history` : "");
    const live = upstreamMode() === "live" && base.length > 0;
    let series: Record<string, { t: number; p: number }[]> = {};
    let stub = !live;
    if (live) {
      try {
        const url = `${base}?assets=${encodeURIComponent(q.assets)}&span=${q.span}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(RPC_TIMEOUT_MS) });
        if (!res.ok) throw new Error(`upstream ${res.status}`);
        const json = (await res.json()) as unknown;
        const raw = (json && typeof json === "object" && "series" in json ? (json as { series: unknown }).series : json) as unknown;
        series = historySeriesSchema.parse(raw);
        stub = false;
        markUpstream("prices", true);
      } catch (e) {
        stub = true;
        markUpstream("prices", false, (e as Error).message);
      }
    }
    const val = { stub, span: q.span, series, cached: false };
    cache.set(key, val, HISTORY_TTL_MS);
    return val;
  });

  // ---- phishing list: dynamic when PHISHLIST_URL set, built-in fallback ----
  const BUILTIN_PHISH = ["evil-drain.example", "wallet-verify-seed.example", "airdrop-claim-free.example"];
  reg("get", "/v1/phishlist", "phishing domain list");
  app.get("/v1/phishlist", async () => {
    const key = "phishlist";
    const hit = cache.get<{ domains: string[]; updatedAt: string; cached: boolean }>(key);
    if (hit) return { ...hit, cached: true };
    const url = envValue("PHISHLIST_URL");
    const live = upstreamMode() === "live" && url.length > 0;
    let domains = BUILTIN_PHISH;
    let updatedAt = new Date(0).toISOString();
    if (live) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(RPC_TIMEOUT_MS) });
        if (!res.ok) throw new Error(`upstream ${res.status}`);
        const json = z.object({ domains: z.array(z.string()), updatedAt: z.string().optional() }).parse(await res.json());
        if (json.domains.length > 0) domains = json.domains;
        updatedAt = json.updatedAt ?? new Date().toISOString();
        markUpstream("phishlist", true);
      } catch (e) {
        markUpstream("phishlist", false, (e as Error).message);
      }
    }
    const val = { domains, updatedAt, cached: false };
    cache.set(key, val, PHISHLIST_TTL_MS);
    return val;
  });

  // ---- push subscriptions (hashed addresses only, never raw addresses) ----
  const subBody = z.object({ hashedAddrHex: z.string().regex(/^[0-9a-f]{64}$/), pushToken: z.string().min(8) });
  reg("post", "/v1/push/subscribe", "subscribe push for hashed address");
  app.post("/v1/push/subscribe", async (req) => {
    const b = subBody.parse(req.body);
    void b;
    return { ok: true };
  });
  const revokeBody = z.object({ hashedAddrHex: z.string().regex(/^[0-9a-f]{64}$/) });
  reg("post", "/v1/push/revoke", "revoke push for hashed address");
  app.post("/v1/push/revoke", async (req) => {
    revokeBody.parse(req.body);
    return { ok: true };
  });
  reg("post", "/v1/push/unsubscribe", "unsubscribe push for hashed address");
  app.post("/v1/push/unsubscribe", async (req) => {
    revokeBody.parse(req.body);
    return { ok: true };
  });

  // ---- broadcasts ----
  const broadcastBody = z.object({ rawTx: z.string().min(1) });
  reg("post", "/v1/evm/{chainId}/broadcast", "broadcast raw EVM tx");
  app.post("/v1/evm/:chainId/broadcast", async (req) => {
    const p = z.object({ chainId: z.string().min(1) }).parse(req.params);
    const body = broadcastBody.parse(req.body);
    const rpcUrl = evmRpcUrl(p.chainId);
    const live = upstreamMode() === "live" && rpcUrl.length > 0;
    if (live) {
      try {
        const result = await rpcCall<string>(rpcUrl, "eth_sendRawTransaction", [body.rawTx]);
        markUpstream(`evm:${p.chainId}`, true);
        if (typeof result === "string") return { txHash: result, stub: false };
        throw new Error("bad result");
      } catch (e) {
        markUpstream(`evm:${p.chainId}`, false, (e as Error).message);
      }
    }
    return { txHash: "0xstub", stub: true };
  });
  reg("post", "/v1/sol/broadcast", "broadcast signed Solana tx");
  app.post("/v1/sol/broadcast", async (req) => {
    const body = broadcastBody.parse(req.body);
    const rpcUrl = envValue("SOLANA_RPC_URL");
    const live = upstreamMode() === "live" && rpcUrl.length > 0;
    if (live) {
      try {
        const result = await rpcCall<string>(rpcUrl, "sendTransaction", [body.rawTx, { encoding: "base64" }]);
        markUpstream("solana", true);
        if (typeof result === "string") return { txSig: result, stub: false };
        throw new Error("bad result");
      } catch (e) {
        markUpstream("solana", false, (e as Error).message);
      }
    }
    return { txSig: "stub", stub: true };
  });
  reg("post", "/v1/btc/broadcast", "broadcast raw BTC tx via Esplora");
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
          signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`upstream ${res.status}`);
        const text = (await res.text()).trim();
        markUpstream("bitcoin", true);
        if (text.length > 0) return { txid: text, stub: false };
      } catch (e) {
        markUpstream("bitcoin", false, (e as Error).message);
      }
    }
    return { txid: "stub", stub: true };
  });
  reg("post", "/v1/ada/broadcast", "submit signed Cardano tx via Koios");
  app.post("/v1/ada/broadcast", async (req) => {
    const body = z.object({ rawTx: z.string().regex(/^[0-9a-fA-F]+$/) }).parse(req.body);
    const baseUrl = envValue("ADA_KOIOS_URL");
    const live = upstreamMode() === "live" && baseUrl.length > 0;
    if (live) {
      try {
        const res = await fetch(`${baseUrl.replace(/\/$/, "")}/submit/tx`, {
          method: "POST",
          headers: { "content-type": "application/cbor" },
          body: Buffer.from(body.rawTx, "hex"),
          signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`upstream ${res.status}`);
        const text = (await res.text()).trim();
        markUpstream("cardano", true);
        if (/^[0-9a-fA-F]{64}$/.test(text)) return { txHash: text.toLowerCase(), stub: false };
        throw new Error("bad koios response");
      } catch (e) {
        markUpstream("cardano", false, (e as Error).message);
      }
    }
    return { txHash: "stub", stub: true };
  });

  // ---- Balance / UTXO / token routes (stub when upstream env missing) ----
  const evmBalParams = z.object({ chainId: z.string().min(1), addr: z.string().min(1) });
  reg("get", "/v1/evm/{chainId}/balance/{addr}", "EVM native balance (wei)");
  app.get("/v1/evm/:chainId/balance/:addr", async (req) => {
    const p = evmBalParams.parse(req.params);
    void hashForLog(p.addr);
    const key = `evm:${p.chainId}:${p.addr.toLowerCase()}`;
    const hit = cache.get<{ balance: string; stub: boolean }>(key);
    if (hit) return { stub: hit.stub, chainId: p.chainId, address: p.addr, balance: hit.balance, balanceWei: hit.balance, cached: true };
    const rpcUrl = evmRpcUrl(p.chainId);
    const live = upstreamMode() === "live" && rpcUrl.length > 0;
    let balance = "0";
    let stub = !live;
    if (live) {
      try {
        const result = await rpcCall<string>(rpcUrl, "eth_getBalance", [p.addr, "latest"]);
        markUpstream(`evm:${p.chainId}`, true);
        if (typeof result === "string" && /^0x[0-9a-fA-F]+$/.test(result)) {
          balance = BigInt(result).toString();
          stub = false;
        } else {
          stub = true;
        }
      } catch (e) {
        stub = true;
        markUpstream(`evm:${p.chainId}`, false, (e as Error).message);
      }
    }
    cache.set(key, { balance, stub }, BALANCE_TTL_MS);
    return { stub, chainId: p.chainId, address: p.addr, balance, balanceWei: balance, cached: false };
  });

  const solBalParams = z.object({ addr: z.string().min(1) });
  reg("get", "/v1/sol/balance/{addr}", "Solana native balance (lamports)");
  app.get("/v1/sol/balance/:addr", async (req) => {
    const p = solBalParams.parse(req.params);
    void hashForLog(p.addr);
    const key = `sol:${p.addr}`;
    const hit = cache.get<{ balance: string; stub: boolean }>(key);
    if (hit) return { stub: hit.stub, address: p.addr, balance: hit.balance, lamports: hit.balance, cached: true };
    const rpcUrl = envValue("SOLANA_RPC_URL");
    const live = upstreamMode() === "live" && rpcUrl.length > 0;
    let balance = "0";
    let stub = !live;
    if (live) {
      try {
        const result = await rpcCall<{ value?: number }>(rpcUrl, "getBalance", [p.addr]);
        markUpstream("solana", true);
        if (typeof result?.value === "number") {
          balance = String(result.value);
          stub = false;
        } else {
          stub = true;
        }
      } catch (e) {
        stub = true;
        markUpstream("solana", false, (e as Error).message);
      }
    }
    cache.set(key, { balance, stub }, BALANCE_TTL_MS);
    return { stub, address: p.addr, balance, lamports: balance, cached: false };
  });

  const btcParams = z.object({ addr: z.string().min(1) });
  reg("get", "/v1/btc/utxo/{addr}", "BTC UTXO set via Esplora");
  app.get("/v1/btc/utxo/:addr", async (req) => {
    const p = btcParams.parse(req.params);
    void hashForLog(p.addr);
    const key = `btc:${p.addr}`;
    const hit = cache.get<{ utxos: unknown[]; stub: boolean }>(key);
    if (hit) return { stub: hit.stub, address: p.addr, utxos: hit.utxos, cached: true };
    const baseUrl = envValue("BTC_ESPLORA_URL");
    const live = upstreamMode() === "live" && baseUrl.length > 0;
    let utxos: unknown[] = [];
    let stub = !live;
    if (live) {
      try {
        const res = await fetch(`${baseUrl.replace(/\/$/, "")}/address/${encodeURIComponent(p.addr)}/utxo`, {
          signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`upstream ${res.status}`);
        const json = (await res.json()) as unknown;
        markUpstream("bitcoin", true);
        if (Array.isArray(json)) {
          utxos = json;
          stub = false;
        } else {
          stub = true;
        }
      } catch (e) {
        stub = true;
        markUpstream("bitcoin", false, (e as Error).message);
      }
    }
    cache.set(key, { utxos, stub }, BALANCE_TTL_MS);
    return { stub, address: p.addr, utxos, cached: false };
  });

  const adaParams = z.object({ addr: z.string().min(1) });
  reg("get", "/v1/ada/utxo/{addr}", "Cardano address info via Koios");
  app.get("/v1/ada/utxo/:addr", async (req) => {
    const p = adaParams.parse(req.params);
    void hashForLog(p.addr);
    const key = `ada:${p.addr}`;
    const hit = cache.get<{ utxos: unknown[]; stub: boolean }>(key);
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
          signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`upstream ${res.status}`);
        const json = (await res.json()) as unknown;
        markUpstream("cardano", true);
        if (Array.isArray(json)) {
          utxos = json;
          stub = false;
        } else if (json && typeof json === "object") {
          utxos = [json];
          stub = false;
        } else {
          stub = true;
        }
      } catch (e) {
        stub = true;
        markUpstream("cardano", false, (e as Error).message);
      }
    }
    cache.set(key, { utxos, stub }, BALANCE_TTL_MS);
    return { stub, address: p.addr, utxos, cached: false };
  });

  const tokensParams = z.object({ chain: z.string().min(1) });
  reg("get", "/v1/tokens/{chain}", "token metadata list for chain");
  app.get("/v1/tokens/:chain", async (req) => {
    const p = tokensParams.parse(req.params);
    const key = `tokens:${p.chain}`;
    const hit = cache.get<{ tokens: unknown[]; stub: boolean }>(key);
    if (hit) return { stub: hit.stub, chain: p.chain, tokens: hit.tokens, cached: true };
    const stub = upstreamMode() === "stub";
    cache.set(key, { tokens: [], stub }, BALANCE_TTL_MS);
    return { stub, chain: p.chain, tokens: [], cached: false };
  });

  // ---- Transaction simulation ----
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
  type SimDiff = z.infer<typeof simulateDiffSchema>;

  function extractDiff(json: unknown): SimDiff | null {
    const j = json as Record<string, unknown>;
    const changes =
      (j as { balanceChanges?: unknown }).balanceChanges ??
      (j as { result?: { balanceChanges?: unknown } }).result?.balanceChanges ??
      (j as { result?: { value?: { balanceChanges?: unknown } } }).result?.value?.balanceChanges ??
      (j as { result?: unknown }).result;
    if (Array.isArray(changes)) return { balanceChanges: changes as SimDiff["balanceChanges"] };
    if (j && typeof j === "object" && (j as { diff?: unknown }).diff) {
      return (j as { diff: SimDiff }).diff;
    }
    return null;
  }

  const evmSimulateBody = z.object({
    chainId: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    dataHex: z.string().regex(/^0x[0-9a-fA-F]*$/).optional(),
    valueWei: z.string().regex(/^\d+$/).optional(),
  });
  reg("post", "/v1/evm/simulate", "simulate EVM call, return balance diff");
  app.post("/v1/evm/simulate", async (req) => {
    const body = evmSimulateBody.parse(req.body);
    const url = envValue("EVM_SIMULATE_URL") || evmRpcUrl(body.chainId);
    const live = upstreamMode() === "live" && url.length > 0;
    let diff: SimDiff | null = null;
    let stub = !live;
    if (live) {
      try {
        const json = await rpcCall<unknown>(url, "eth_call", [
          { from: body.from, to: body.to, data: body.dataHex ?? "0x", value: body.valueWei ? `0x${BigInt(body.valueWei).toString(16)}` : "0x0" },
          "latest",
        ]);
        markUpstream(`evm:${body.chainId}`, true);
        diff = extractDiff(json);
        stub = diff === null;
      } catch (e) {
        stub = true;
        markUpstream(`evm:${body.chainId}`, false, (e as Error).message);
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
  reg("post", "/v1/sol/simulate", "simulate Solana tx, return balance diff");
  app.post("/v1/sol/simulate", async (req) => {
    const body = solSimulateBody.parse(req.body);
    const url = envValue("SOLANA_SIMULATE_URL") || envValue("SOLANA_RPC_URL");
    const live = upstreamMode() === "live" && url.length > 0;
    let diff: SimDiff | null = null;
    let stub = !live;
    if (live) {
      try {
        const json = await rpcCall<unknown>(url, "simulateTransaction", [body.transactionBase64 ?? body.messageBase64, { encoding: "base64" }]);
        markUpstream("solana", true);
        diff = extractDiff(json);
        stub = diff === null;
      } catch (e) {
        stub = true;
        markUpstream("solana", false, (e as Error).message);
      }
    }
    const resp = { stub, diff, cached: false };
    return simulateResponseSchema.parse(resp);
  });

  // ---- Generic allowlisted read-only JSON-RPC passthrough (EVM) ----
  // Lets apps do eth_call (ENS resolution etc.) through the gateway without
  // opening extension CSP connect-src to arbitrary RPC hosts.
  const RPC_ALLOWLIST = new Set([
    "eth_call", "eth_getBalance", "eth_blockNumber", "eth_getBlockByNumber",
    "eth_getBlockByHash", "eth_getTransactionCount", "eth_getTransactionByHash",
    "eth_getTransactionReceipt", "eth_getCode", "eth_chainId", "eth_gasPrice",
    "eth_feeHistory", "eth_estimateGas", "eth_getLogs", "net_version", "web3_clientVersion",
  ]);
  const RPC_ID_METHODS = new Set(["eth_chainId", "net_version", "web3_clientVersion"]);
  const rpcPassthroughBody = z.object({
    method: z.string().min(1).max(64),
    params: z.array(z.unknown()).default([]),
  });
  reg("post", "/v1/evm/{chainId}/rpc", "allowlisted read-only JSON-RPC passthrough");
  app.post("/v1/evm/:chainId/rpc", async (req, reply) => {
    const p = z.object({ chainId: z.string().min(1) }).parse(req.params);
    const body = rpcPassthroughBody.parse(req.body);
    if (!RPC_ALLOWLIST.has(body.method)) {
      return reply.status(400).send({ error: "method_not_allowed" });
    }
    const cacheable = RPC_ID_METHODS.has(body.method);
    const key = `rpc:${p.chainId}:${body.method}:${JSON.stringify(body.params)}`;
    if (cacheable) {
      const hit = cache.get<{ stub: boolean; result: unknown }>(key);
      if (hit) return { ...hit, cached: true };
    }
    const rpcUrl = evmRpcUrl(p.chainId);
    const live = upstreamMode() === "live" && rpcUrl.length > 0;
    if (!live) return { stub: true, result: null, cached: false };
    try {
      const result = await rpcCall<unknown>(rpcUrl, body.method, body.params);
      markUpstream(`evm:${p.chainId}`, true);
      const val = { stub: false, result, cached: false };
      if (cacheable) cache.set(key, val, RPC_ID_CACHE_MS);
      return val;
    } catch (e) {
      markUpstream(`evm:${p.chainId}`, false, (e as Error).message);
      return reply.status(502).send({ error: "upstream_error" });
    }
  });

  // ---- EVM fee estimate: gas limit + low/med/high EIP-1559 tiers ----
  const feeQuery = z.object({
    from: z.string().min(1),
    to: z.string().min(1),
    data: z.string().regex(/^0x[0-9a-fA-F]*$/).optional(),
    value: z.string().regex(/^\d+$/).optional(),
  });
  const feeTierSchema = z.object({
    maxFeePerGasWei: z.string().regex(/^\d+$/),
    maxPriorityFeePerGasWei: z.string().regex(/^\d+$/),
  });
  const feeRespSchema = z.object({
    stub: z.boolean(),
    chainId: z.string(),
    gasLimit: z.string().regex(/^\d+$/),
    tiers: z.object({
      low: feeTierSchema,
      med: feeTierSchema,
      high: feeTierSchema,
    }),
    cached: z.boolean(),
  });
  reg("get", "/v1/evm/{chainId}/fee-estimate", "gas limit + low/med/high fee tiers");
  app.get("/v1/evm/:chainId/fee-estimate", async (req) => {
    const p = z.object({ chainId: z.string().min(1) }).parse(req.params);
    const q = feeQuery.parse(req.query);
    const key = `fee:${p.chainId}:${q.from}:${q.to}:${q.data ?? ""}:${q.value ?? ""}`;
    const hit = cache.get<z.infer<typeof feeRespSchema>>(key);
    if (hit) return { ...hit, cached: true };
    const rpcUrl = evmRpcUrl(p.chainId);
    const live = upstreamMode() === "live" && rpcUrl.length > 0;
    const stubResp = { stub: true, chainId: p.chainId, gasLimit: "21000", tiers: { low: { maxFeePerGasWei: "0", maxPriorityFeePerGasWei: "0" }, med: { maxFeePerGasWei: "0", maxPriorityFeePerGasWei: "0" }, high: { maxFeePerGasWei: "0", maxPriorityFeePerGasWei: "0" } }, cached: false };
    if (!live) return feeRespSchema.parse(stubResp);
    try {
      const txObj = {
        from: q.from,
        to: q.to,
        ...(q.data ? { data: q.data } : {}),
        ...(q.value ? { value: `0x${BigInt(q.value).toString(16)}` } : {}),
      };
      const gasHex = await rpcCall<string>(rpcUrl, "eth_estimateGas", [txObj]);
      const gasLimit = BigInt(gasHex).toString();
      // fee tiers via eth_feeHistory percentiles; fallback to eth_gasPrice
      let base: bigint;
      let prio: { low: bigint; med: bigint; high: bigint };
      try {
        const hist = await rpcCall<{ baseFeePerGas?: string[]; reward?: string[][] }>(rpcUrl, "eth_feeHistory", ["0x5", "latest", [10, 50, 90]]);
        const baseFees = hist.baseFeePerGas ?? [];
        const rewards = hist.reward ?? [];
        base = BigInt(baseFees[baseFees.length - 1] ?? "0x0");
        const pick = (i: number): bigint => {
          const r = rewards[i]?.[0];
          return r ? BigInt(r) : 0n;
        };
        prio = { low: pick(0), med: pick(1), high: pick(2) };
      } catch {
        const gp = BigInt(await rpcCall<string>(rpcUrl, "eth_gasPrice", []));
        base = gp;
        prio = { low: (gp * 8n) / 10n, med: gp, high: (gp * 15n) / 10n };
      }
      const mk = (pr: bigint) => ({
        maxFeePerGasWei: (base * 2n + pr).toString(),
        maxPriorityFeePerGasWei: pr.toString(),
      });
      const val = feeRespSchema.parse({
        stub: false,
        chainId: p.chainId,
        gasLimit,
        tiers: { low: mk(prio.low), med: mk(prio.med), high: mk(prio.high) },
        cached: false,
      });
      cache.set(key, val, BALANCE_TTL_MS);
      markUpstream(`evm:${p.chainId}`, true);
      return val;
    } catch (e) {
      markUpstream(`evm:${p.chainId}`, false, (e as Error).message);
      return feeRespSchema.parse(stubResp);
    }
  });

  // ---- ERC-20 token balances for an address ----
  const DEFAULT_TOKENS: Record<number, { symbol: string; address: string; decimals: number }[]> = {
    1: [
      { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
      { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
      { symbol: "WETH", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
    ],
    56: [
      { symbol: "USDC", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
      { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
      { symbol: "WETH", address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", decimals: 18 },
    ],
    137: [
      { symbol: "USDC", address: "0x2791bCa1f2de4661eD88a30c119A2dEbcF2f3837", decimals: 6 },
      { symbol: "USDT", address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
      { symbol: "WETH", address: "0x7CEb23fD6bc0adD59E62Ac25578270cf1b9f619C", decimals: 18 },
    ],
    42161: [
      { symbol: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
      { symbol: "USDT", address: "0xFD086bc7cD5c4815adaE9B83DBE69B30ccb055BF", decimals: 6 },
      { symbol: "WETH", address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18 },
    ],
    8453: [
      { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
      { symbol: "USDT", address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6 },
      { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    ],
  };
  const ERC20_ADDR = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
  function word(addr: string): string {
    return addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  }
  async function evmEthCall(rpcUrl: string, to: string, data: string): Promise<string> {
    return rpcCall<string>(rpcUrl, "eth_call", [{ to, data }, "latest"]);
  }
  const tokenBalanceItem = z.object({
    address: ERC20_ADDR,
    symbol: z.string().optional(),
    decimals: z.number().int().optional(),
    balanceBaseUnits: z.string().regex(/^\d+$/),
  });
  reg("get", "/v1/evm/{chainId}/tokens/{addr}", "ERC-20 balances for address");
  app.get("/v1/evm/:chainId/tokens/:addr", async (req) => {
    const p = z.object({ chainId: z.string().min(1), addr: z.string().min(1) }).parse(req.params);
    void hashForLog(p.addr);
    const q = z.object({ tokens: z.string().optional() }).parse(req.query);
    const num = evmChainNum(p.chainId);
    let list: { address: string; symbol?: string; decimals?: number }[] = [];
    if (q.tokens) {
      for (const t of q.tokens.split(",")) {
        const a = t.trim();
        if (ERC20_ADDR.safeParse(a).success) list.push({ address: a });
      }
    } else if (num !== null && DEFAULT_TOKENS[num]) {
      list = DEFAULT_TOKENS[num];
    }
    const key = `evmtokens:${p.chainId}:${p.addr.toLowerCase()}:${q.tokens ?? "default"}`;
    const hit = cache.get<{ stub: boolean; items: unknown[] }>(key);
    if (hit) return { stub: hit.stub, chainId: p.chainId, address: p.addr, tokens: hit.items, cached: true };
    const rpcUrl = evmRpcUrl(p.chainId);
    const live = upstreamMode() === "live" && rpcUrl.length > 0 && list.length > 0;
    const items: z.infer<typeof tokenBalanceItem>[] = [];
    let stub = !live;
    if (live) {
      try {
        for (const t of list) {
          const balHex = await evmEthCall(rpcUrl, t.address, `0x70a08231${word(p.addr)}`);
          let decimals = t.decimals;
          let symbol = t.symbol;
          try {
            const decHex = await evmEthCall(rpcUrl, t.address, "0x313ce567");
            if (/^0x[0-9a-fA-F]+$/.test(decHex)) decimals = Number(BigInt(decHex));
          } catch { /* keep default */ }
          try {
            const symHex = await evmEthCall(rpcUrl, t.address, "0x95d89b41");
            if (/^0x[0-9a-fA-F]+$/.test(symHex)) {
              const buf = Buffer.from(symHex.slice(2), "hex");
              const len = buf.length >= 32 ? Number(BigInt("0x" + buf.subarray(0, 32).toString("hex"))) : 0;
              const raw = buf.subarray(32, 32 + Math.min(len, 32)).toString("utf8").replace(/\0/g, "");
              if (raw.length > 0 && raw.length <= 12) symbol = raw;
            }
          } catch { /* keep default */ }
          items.push(tokenBalanceItem.parse({
            address: t.address,
            symbol,
            decimals,
            balanceBaseUnits: /^0x[0-9a-fA-F]+$/.test(balHex) ? BigInt(balHex).toString() : "0",
          }));
        }
        stub = false;
        markUpstream(`evm:${p.chainId}`, true);
      } catch (e) {
        stub = true;
        markUpstream(`evm:${p.chainId}`, false, (e as Error).message);
      }
    }
    cache.set(key, { stub, items }, BALANCE_TTL_MS);
    return { stub, chainId: p.chainId, address: p.addr, tokens: items, cached: false };
  });

  // ---- EVM transaction status (activity feed) ----
  reg("get", "/v1/evm/{chainId}/tx/{hash}", "EVM tx receipt status");
  app.get("/v1/evm/:chainId/tx/:hash", async (req) => {
    const p = z.object({ chainId: z.string().min(1), hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).parse(req.params);
    const key = `tx:${p.chainId}:${p.hash.toLowerCase()}`;
    const hit = cache.get<{ stub: boolean; status: string; blockNumber: string | null; gasUsed: string | null; cached: boolean }>(key);
    if (hit) return { ...hit, txHash: p.hash, cached: true };
    const rpcUrl = evmRpcUrl(p.chainId);
    const live = upstreamMode() === "live" && rpcUrl.length > 0;
    let status = "unknown";
    let blockNumber: string | null = null;
    let gasUsed: string | null = null;
    let stub = !live;
    if (live) {
      try {
        const r = await rpcCall<null | { status?: string; blockNumber?: string; gasUsed?: string }>(rpcUrl, "eth_getTransactionReceipt", [p.hash]);
        markUpstream(`evm:${p.chainId}`, true);
        if (r === null) {
          status = "pending";
        } else {
          status = r.status === "0x1" ? "success" : "failed";
          blockNumber = r.blockNumber ? BigInt(r.blockNumber).toString() : null;
          gasUsed = r.gasUsed ? BigInt(r.gasUsed).toString() : null;
        }
        stub = false;
      } catch (e) {
        stub = true;
        markUpstream(`evm:${p.chainId}`, false, (e as Error).message);
      }
    }
    const val = { stub, status, blockNumber, gasUsed, cached: false };
    cache.set(key, val, BALANCE_TTL_MS);
    return { ...val, txHash: p.hash };
  });

  // ---- SPL token accounts ----
  const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const splItem = z.object({
    mint: z.string().min(32).max(44),
    tokenAccount: z.string().min(32).max(44),
    amountBaseUnits: z.string().regex(/^\d+$/),
    decimals: z.number().int().min(0).max(18).optional(),
  });
  reg("get", "/v1/sol/tokens/{addr}", "SPL token balances for owner");
  app.get("/v1/sol/tokens/:addr", async (req) => {
    const p = z.object({ addr: z.string().min(32).max(44) }).parse(req.params);
    void hashForLog(p.addr);
    const key = `soltokens:${p.addr}`;
    const hit = cache.get<{ stub: boolean; items: unknown[] }>(key);
    if (hit) return { stub: hit.stub, address: p.addr, tokens: hit.items, cached: true };
    const rpcUrl = envValue("SOLANA_RPC_URL");
    const live = upstreamMode() === "live" && rpcUrl.length > 0;
    const items: z.infer<typeof splItem>[] = [];
    let stub = !live;
    if (live) {
      try {
        const res = await rpcCall<{ value?: { pubkey: string; account: { data: [string, string] } }[] }>(rpcUrl, "getTokenAccountsByOwner", [
          p.addr,
          { programId: TOKEN_PROGRAM },
          { encoding: "base64" },
        ]);
        const accounts = res.value ?? [];
        const mints = new Set<string>();
        const parsed: { mint: string; tokenAccount: string; amountBaseUnits: string }[] = [];
        for (const acc of accounts) {
          try {
            const buf = Buffer.from(acc.account.data[0], "base64");
            if (buf.length < 72) continue;
            const mint = base58Encode(buf.subarray(0, 32));
            const amount = buf.readBigUInt64LE(64);
            mints.add(mint);
            parsed.push({ mint, tokenAccount: acc.pubkey, amountBaseUnits: amount.toString() });
          } catch { /* skip malformed account */ }
        }
        let decimalsByMint = new Map<string, number>();
        if (mints.size > 0) {
          try {
            const multi = await rpcCall<{ value?: ({ data: [string, string] } | null)[] }>(rpcUrl, "getMultipleAccounts", [
              [...mints],
              { encoding: "base64" },
            ]);
            (multi.value ?? []).forEach((acc, i) => {
              if (!acc) return;
              const buf = Buffer.from(acc.data[0], "base64");
              if (buf.length > 44) decimalsByMint.set([...mints][i] as string, buf.readUInt8(44));
            });
          } catch { /* decimals optional */ }
        }
        for (const t of parsed) {
          items.push(splItem.parse({ ...t, decimals: decimalsByMint.get(t.mint) }));
        }
        stub = false;
        markUpstream("solana", true);
      } catch (e) {
        stub = true;
        markUpstream("solana", false, (e as Error).message);
      }
    }
    cache.set(key, { stub, items }, BALANCE_TTL_MS);
    return { stub, address: p.addr, tokens: items, cached: false };
  });

  // ---- Solana signature status ----
  reg("get", "/v1/sol/tx/{sig}", "Solana signature status");
  app.get("/v1/sol/tx/:sig", async (req) => {
    const p = z.object({ sig: z.string().min(64).max(88) }).parse(req.params);
    const key = `soltx:${p.sig}`;
    const hit = cache.get<{ stub: boolean; status: string; slot: number | null; err: unknown; cached: boolean }>(key);
    if (hit) return { ...hit, signature: p.sig, cached: true };
    const rpcUrl = envValue("SOLANA_RPC_URL");
    const live = upstreamMode() === "live" && rpcUrl.length > 0;
    let status = "unknown";
    let slot: number | null = null;
    let err: unknown = null;
    let stub = !live;
    if (live) {
      try {
        const res = await rpcCall<{ value?: ({ slot?: number; err?: unknown; confirmationStatus?: string } | null)[] }>(rpcUrl, "getSignatureStatuses", [[p.sig]]);
        markUpstream("solana", true);
        const v = res.value?.[0] ?? null;
        if (v === null) {
          status = "pending";
        } else {
          status = v.err ? "failed" : "success";
          slot = typeof v.slot === "number" ? v.slot : null;
          err = v.err ?? null;
        }
        stub = false;
      } catch (e) {
        stub = true;
        markUpstream("solana", false, (e as Error).message);
      }
    }
    const val = { stub, status, slot, err, cached: false };
    cache.set(key, val, BALANCE_TTL_MS);
    return { ...val, signature: p.sig };
  });

  // ---- Swap quote proxy: 0x (EVM) / Jupiter (Solana), normalized + validated ----
  const swapQuoteBody = z.object({
    chain: z.string().min(1),
    sellToken: z.string().min(1),
    buyToken: z.string().min(1),
    sellAmountBaseUnits: z.string().regex(/^\d+$/),
    slippageBps: z.number().int().min(1).max(5000),
    taker: z.string().optional(),
  });
  const quoteSchema = z.object({
    sellToken: z.string().min(1),
    buyToken: z.string().min(1),
    sellAmountBaseUnits: z.string().regex(/^\d+$/),
    buyAmountBaseUnits: z.string().regex(/^\d+$/),
    priceImpactPct: z.string().regex(/^\d+(\.\d+)?$/),
    allowanceNeededBaseUnits: z.string().regex(/^\d+$/).optional(),
    routeId: z.string().optional(),
  });
  const NATIVE_EVM = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  const NATIVE_SOL = "So11111111111111111111111111111111111111112";
  reg("post", "/v1/swap/quote", "aggregator quote (0x EVM / Jupiter SOL), unsigned");
  app.post("/v1/swap/quote", async (req, reply) => {
    const body = swapQuoteBody.parse(req.body);
    const key = `swap:${JSON.stringify(body)}`;
    const hit = cache.get<{ stub: boolean; quote: unknown }>(key);
    if (hit) return { ...hit, cached: true };
    const isEvm = body.chain.toLowerCase().startsWith("eip155:");
    const isSol = body.chain.toLowerCase().startsWith("solana:");
    if (!isEvm && !isSol) return reply.status(400).send({ error: "bad_request" });
    let stub = true;
    let quote: z.infer<typeof quoteSchema> | null = null;
    if (isEvm) {
      const base = envValue("SWAP_0X_API_URL");
      const live = upstreamMode() === "live" && base.length > 0;
      if (live) {
        try {
          const num = evmChainNum(body.chain);
          const sell = body.sellToken.toLowerCase() === "native" ? NATIVE_EVM : body.sellToken;
          const buy = body.buyToken.toLowerCase() === "native" ? NATIVE_EVM : body.buyToken;
          const params = new URLSearchParams({
            chainId: String(num),
            sellToken: sell,
            buyToken: buy,
            sellAmount: body.sellAmountBaseUnits,
            slippagePercentage: String(body.slippageBps / 100),
          });
          if (body.taker) params.set("taker", body.taker);
          const headers: Record<string, string> = {};
          const apiKey = envValue("ZEROX_API_KEY");
          if (apiKey) headers["0x-api-key"] = apiKey;
          const res = await fetch(`${base.replace(/\/$/, "")}/swap/v1/quote?${params.toString()}`, {
            headers,
            signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
          });
          if (!res.ok) throw new Error(`upstream ${res.status}`);
          const j = z
            .object({
              buyAmount: z.string().regex(/^\d+$/),
              estimatedPriceImpact: z.string().optional(),
              allowanceTarget: z.string().optional(),
              to: z.string().optional(),
              value: z.string().optional(),
            })
            .parse(await res.json());
          markUpstream("swap:0x", true);
          quote = quoteSchema.parse({
            sellToken: body.sellToken,
            buyToken: body.buyToken,
            sellAmountBaseUnits: body.sellAmountBaseUnits,
            buyAmountBaseUnits: j.buyAmount,
            priceImpactPct: j.estimatedPriceImpact ?? "0",
            allowanceNeededBaseUnits: sell.toLowerCase() === NATIVE_EVM ? "0" : body.sellAmountBaseUnits,
            routeId: j.to ?? j.allowanceTarget,
          });
          stub = false;
        } catch (e) {
          markUpstream("swap:0x", false, (e as Error).message);
        }
      }
    } else {
      const base = envValue("SWAP_JUPITER_API_URL");
      const live = upstreamMode() === "live" && base.length > 0;
      if (live) {
        try {
          const input = body.sellToken.toUpperCase() === "SOL" ? NATIVE_SOL : body.sellToken;
          const output = body.buyToken.toUpperCase() === "SOL" ? NATIVE_SOL : body.buyToken;
          const params = new URLSearchParams({
            inputMint: input,
            outputMint: output,
            amount: body.sellAmountBaseUnits,
            slippageBps: String(body.slippageBps),
          });
          const res = await fetch(`${base.replace(/\/$/, "")}/quote?${params.toString()}`, {
            signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
          });
          if (!res.ok) throw new Error(`upstream ${res.status}`);
          const j = z
            .object({
              outAmount: z.string().regex(/^\d+$/),
              priceImpactPct: z.union([z.string(), z.number()]).optional(),
              routePlan: z.array(z.unknown()).optional(),
            })
            .parse(await res.json());
          markUpstream("swap:jupiter", true);
          quote = quoteSchema.parse({
            sellToken: body.sellToken,
            buyToken: body.buyToken,
            sellAmountBaseUnits: body.sellAmountBaseUnits,
            buyAmountBaseUnits: j.outAmount,
            priceImpactPct: typeof j.priceImpactPct === "number" ? String(j.priceImpactPct) : (j.priceImpactPct ?? "0"),
            allowanceNeededBaseUnits: "0",
            routeId: j.routePlan && j.routePlan.length > 0 ? "jupiter-route" : undefined,
          });
          stub = false;
        } catch (e) {
          markUpstream("swap:jupiter", false, (e as Error).message);
        }
      }
    }
    const val = { stub, quote, cached: false };
    cache.set(key, val, PRICE_TTL_MS);
    return val;
  });

  // ---- NFT index (provider URL template with {chain} {addr}) ----
  const nftItem = z.object({
    contract: z.string().optional(),
    tokenId: z.string().min(1),
    name: z.string().optional(),
    collection: z.string().optional(),
    imageUrl: z.string().url().optional(),
  });
  reg("get", "/v1/nfts/{chain}/{addr}", "NFT holdings via configured indexer");
  app.get("/v1/nfts/:chain/:addr", async (req) => {
    const p = z.object({ chain: z.string().min(1), addr: z.string().min(1) }).parse(req.params);
    void hashForLog(p.addr);
    const key = `nfts:${p.chain}:${p.addr.toLowerCase()}`;
    const hit = cache.get<{ stub: boolean; items: unknown[] }>(key);
    if (hit) return { stub: hit.stub, chain: p.chain, address: p.addr, items: hit.items, cached: true };
    const tmpl = envValue("NFT_API_URL");
    const live = upstreamMode() === "live" && tmpl.includes("{addr}");
    let items: z.infer<typeof nftItem>[] = [];
    let stub = !live;
    if (live) {
      try {
        const url = tmpl.replace("{chain}", encodeURIComponent(p.chain)).replace("{addr}", encodeURIComponent(p.addr));
        const res = await fetch(url, { signal: AbortSignal.timeout(RPC_TIMEOUT_MS) });
        if (!res.ok) throw new Error(`upstream ${res.status}`);
        const json = (await res.json()) as unknown;
        const raw = Array.isArray(json) ? json : (json && typeof json === "object" && "items" in json ? (json as { items: unknown }).items : []);
        items = z.array(nftItem).parse(raw);
        stub = false;
        markUpstream("nfts", true);
      } catch (e) {
        stub = true;
        markUpstream("nfts", false, (e as Error).message);
      }
    }
    cache.set(key, { stub, items }, NFT_TTL_MS);
    return { stub, chain: p.chain, address: p.addr, items, cached: false };
  });

  // ---- OpenAPI generated from the route registry (F-P1-4) ----
  reg("get", "/openapi.json", "this document");
  app.get("/openapi.json", async () => {
    const paths: Record<string, Record<string, { summary: string }>> = {};
    for (const r of routeSpecs) {
      const entry = paths[r.path] ?? {};
      entry[r.method] = { summary: r.summary };
      paths[r.path] = entry;
    }
    return { openapi: "3.0.0", info: { title: "drift-gateway", version: VERSION }, paths };
  });

  return app;
}

if (process.argv[1]?.endsWith("index.ts")) {
  const app = buildServer();
  const host = process.env.HOST ?? (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
  await app.listen({ port: Number(process.env.PORT ?? 8787), host });
}
