// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

export const GatewayConfig = z.object({ baseUrl: z.string().url(), apiKey: z.string().optional() });
export type GatewayConfig = z.infer<typeof GatewayConfig>;

export function sha256Hex(input: string): string {
  // Node/WASM-agnostic placeholder — production uses SubtleCrypto; tests use djb2-free simple hash note.
  // gateway-client never sends raw addresses for push: callers must pass sha256(address).
  // This helper documents the contract; real hashing happens in apps via SubtleCrypto.
  void input;
  throw new Error("use apps' subtleCrypto.sha256Hex — gateway-client forbids raw addresses");
}

export function pushSubscribeBody(hashedAddrHex: string, pushToken: string) {
  if (!/^[0-9a-f]{64}$/.test(hashedAddrHex)) throw new Error("hashedAddr must be sha256 hex");
  if (pushToken.length < 8) throw new Error("bad push token");
  return { hashedAddrHex, pushToken };
}

// ---------------------------------------------------------------------------
// T008-client: typed gateway client. Never sends raw seed/mnemonic (no such
// params exist anywhere in this module). All responses zod-validated.
// ---------------------------------------------------------------------------

export const CLIENT_VERSION_HEADER = "wallet/0.1.0";

/** Injectable transport; defaults to global fetch. Tests pass a mock. */
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const UintStr = z.string().regex(/^\d+$/);

const PricesResp = z.object({ prices: z.record(z.string(), z.number()), cached: z.boolean().optional() });
const EvmBalanceResp = z.object({ balanceWei: UintStr });
const EvmBroadcastResp = z.object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) });
const SolBroadcastResp = z.object({ txSig: z.string().min(1) });
const BtcBroadcastResp = z.object({ txid: z.string().regex(/^[0-9a-fA-F]{64}$/) });
const AdaBroadcastResp = z.object({ txHash: z.string().min(1) });
const PhishlistResp = z.object({ domains: z.array(z.string()), updatedAt: z.string() });
const PushSubscribeResp = z.object({ ok: z.literal(true) });

// ---- Iteration 3 response schemas (all money as bigint-parseable strings) ----
const SolBalanceResp = z.object({ lamports: UintStr });
const UtxosResp = z.object({ utxos: z.array(z.unknown()) });
const FeeTier = z.object({ maxFeePerGasWei: UintStr, maxPriorityFeePerGasWei: UintStr });
const FeeEstimateResp = z.object({
  stub: z.boolean(),
  chainId: z.string(),
  gasLimit: UintStr,
  tiers: z.object({ low: FeeTier, med: FeeTier, high: FeeTier }),
});
const EvmTokenItem = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  symbol: z.string().optional(),
  decimals: z.number().int().optional(),
  balanceBaseUnits: UintStr,
});
const EvmTokensResp = z.object({ stub: z.boolean(), tokens: z.array(EvmTokenItem) });
const EvmTxStatusResp = z.object({
  stub: z.boolean(),
  status: z.enum(["pending", "success", "failed", "unknown"]),
  blockNumber: UintStr.nullable(),
  gasUsed: UintStr.nullable(),
});
const RpcPassthroughResp = z.object({ stub: z.boolean(), result: z.unknown() });
const SplItem = z.object({
  mint: z.string(),
  tokenAccount: z.string(),
  amountBaseUnits: UintStr,
  decimals: z.number().int().optional(),
});
const SolTokensResp = z.object({ stub: z.boolean(), tokens: z.array(SplItem) });
const SolTxStatusResp = z.object({
  stub: z.boolean(),
  status: z.enum(["pending", "success", "failed", "unknown"]),
  slot: z.number().nullable(),
  err: z.unknown().nullable(),
});
const PricePoint = z.object({ t: z.number(), p: z.number() });
const HistoryResp = z.object({
  stub: z.boolean(),
  span: z.string(),
  series: z.record(z.string(), z.array(PricePoint)),
});
const SwapQuoteResp = z.object({
  stub: z.boolean(),
  quote: z
    .object({
      sellToken: z.string(),
      buyToken: z.string(),
      sellAmountBaseUnits: UintStr,
      buyAmountBaseUnits: UintStr,
      priceImpactPct: z.string().regex(/^\d+(\.\d+)?$/),
      allowanceNeededBaseUnits: UintStr.optional(),
      routeId: z.string().optional(),
    })
    .nullable(),
});
const NftItem = z.object({
  contract: z.string().optional(),
  tokenId: z.string(),
  name: z.string().optional(),
  collection: z.string().optional(),
  imageUrl: z.string().optional(),
});
const NftsResp = z.object({ stub: z.boolean(), items: z.array(NftItem) });
const HealthResp = z.object({
  ok: z.boolean(),
  service: z.string(),
  version: z.string(),
  mode: z.enum(["stub", "live"]),
  keysHeld: z.literal(false),
  upstreams: z.record(z.string(), z.object({ ok: z.boolean(), at: z.number(), detail: z.string().optional() })).optional(),
});
const SimResp = z.object({
  stub: z.boolean(),
  diff: z
    .object({
      balanceChanges: z.array(
        z.object({ address: z.string(), asset: z.string(), before: UintStr, after: UintStr }),
      ),
    })
    .nullable(),
});

export interface CreateGatewayClientInput {
  baseUrl: string;
  apiKey?: string;
  fetchFn?: FetchFn;
}

export interface FeeTierBig {
  maxFeePerGasWei: bigint;
  maxPriorityFeePerGasWei: bigint;
}
export interface FeeEstimate {
  stub: boolean;
  gasLimit: bigint;
  tiers: { low: FeeTierBig; med: FeeTierBig; high: FeeTierBig };
}
export interface EvmTokenBalance {
  address: string;
  symbol?: string | undefined;
  decimals?: number | undefined;
  balanceBaseUnits: bigint;
}
export interface TxStatus {
  stub: boolean;
  status: "pending" | "success" | "failed" | "unknown";
  blockNumber: bigint | null;
  gasUsed: bigint | null;
}
export interface SplBalance {
  mint: string;
  tokenAccount: string;
  amountBaseUnits: bigint;
  decimals?: number | undefined;
}
export interface SolTxStatus {
  stub: boolean;
  status: "pending" | "success" | "failed" | "unknown";
  slot: number | null;
  err: unknown;
}
export interface PriceSeries {
  stub: boolean;
  span: string;
  series: Record<string, { t: number; p: number }[]>;
}
export interface SwapQuote {
  sellToken: string;
  buyToken: string;
  sellAmountBaseUnits: bigint;
  buyAmountBaseUnits: bigint;
  priceImpactPct: string;
  allowanceNeededBaseUnits?: bigint | undefined;
  routeId?: string | undefined;
}
export interface Nft {
  contract?: string | undefined;
  tokenId: string;
  name?: string | undefined;
  collection?: string | undefined;
  imageUrl?: string | undefined;
}
export interface Health {
  ok: boolean;
  version: string;
  mode: "stub" | "live";
  keysHeld: false;
  upstreams?: Record<string, { ok: boolean; at: number; detail?: string | undefined }> | undefined;
}
export interface SimDiff {
  stub: boolean;
  diff: { balanceChanges: { address: string; asset: string; before: bigint; after: bigint }[] } | null;
}

export interface GatewayClient {
  getPrices(assets: string[]): Promise<Record<string, number>>;
  getPricesHistory(assets: string[], span: "1d" | "7d" | "30d" | "1y"): Promise<PriceSeries>;
  getEvmBalance(chainId: number, address: string): Promise<bigint>;
  getSolBalance(address: string): Promise<bigint>;
  getBtcUtxos(address: string): Promise<unknown[]>;
  getAdaUtxos(address: string): Promise<unknown[]>;
  evmRpc<T>(chainId: number, method: string, params: unknown[]): Promise<{ stub: boolean; result: T | null }>;
  getFeeEstimate(chainId: number, input: { from: string; to: string; data?: string; value?: string }): Promise<FeeEstimate>;
  getEvmTokenBalances(chainId: number, address: string, tokens?: string[]): Promise<{ stub: boolean; tokens: EvmTokenBalance[] }>;
  getEvmTxStatus(chainId: number, hash: string): Promise<TxStatus>;
  getSolTokenBalances(address: string): Promise<{ stub: boolean; tokens: SplBalance[] }>;
  getSolTxStatus(sig: string): Promise<SolTxStatus>;
  getSwapQuote(input: { chain: string; sellToken: string; buyToken: string; sellAmountBaseUnits: string; slippageBps: number; taker?: string }): Promise<{ stub: boolean; quote: SwapQuote | null }>;
  getNfts(chain: string, address: string): Promise<{ stub: boolean; items: Nft[] }>;
  getHealth(): Promise<Health>;
  simulateEvm(input: { chainId: string; from: string; to: string; dataHex?: string; valueWei?: string }): Promise<SimDiff>;
  simulateSol(input: { messageBase64?: string; transactionBase64?: string }): Promise<SimDiff>;
  broadcastEvm(chainId: number, rawTx: string): Promise<string>;
  broadcastSol(signedTxBase64: string): Promise<string>;
  broadcastBtc(psbtBase64: string): Promise<string>;
  broadcastAda(signedTxHex: string): Promise<string>;
  getPhishlist(): Promise<{ domains: string[]; updatedAt: string }>;
  subscribePush(hashedAddrHex: string, pushToken: string): Promise<{ ok: true }>;
  revokePush(hashedAddrHex: string): Promise<{ ok: true }>;
}

export function createGatewayClient(input: CreateGatewayClientInput): GatewayClient {
  const cfg = z.object({ baseUrl: z.string().url(), apiKey: z.string().optional() }).parse(input);
  const base = cfg.baseUrl.replace(/\/$/, "");
  const customFetch: unknown = (input as { fetchFn?: unknown }).fetchFn;
  let transport: FetchFn;
  if (customFetch === undefined) {
    const g = (globalThis as { fetch?: unknown }).fetch;
    if (typeof g !== "function") throw new Error("no fetch available");
    transport = g as FetchFn;
  } else if (typeof customFetch === "function") {
    transport = customFetch as FetchFn;
  } else {
    throw new Error("fetchFn must be a function");
  }

  async function request<T>(schema: z.ZodType<T>, path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      "X-Drift-Client": CLIENT_VERSION_HEADER,
      ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
    };
    if (init?.body !== undefined) headers["content-type"] = "application/json";
    const res = await transport(`${base}${path}`, {
      ...init,
      headers: { ...headers, ...((init?.headers as Record<string, string> | undefined) ?? {}) },
    });
    if (!res.ok) throw new Error(`gateway ${res.status} for ${path}`);
    return schema.parse((await res.json()) as unknown);
  }

  return {
    async getPrices(assets: string[]): Promise<Record<string, number>> {
      const list = z.array(z.string().regex(/^[A-Z]{2,10}$/)).min(1).parse(assets);
      const body = await request(PricesResp, `/v1/prices?assets=${list.join(",")}`);
      return body.prices;
    },
    async getEvmBalance(chainId: number, address: string): Promise<bigint> {
      z.number().int().positive().parse(chainId);
      z.string().regex(/^0x[0-9a-fA-F]{40}$/).parse(address);
      const body = await request(EvmBalanceResp, `/v1/evm/${chainId}/balance/${address}`);
      return BigInt(body.balanceWei);
    },
    async broadcastEvm(chainId: number, rawTx: string): Promise<string> {
      z.number().int().positive().parse(chainId);
      z.string().regex(/^0x[0-9a-fA-F]+$/).parse(rawTx);
      if (rawTx.length < 10) throw new Error("rawTx too short");
      const body = await request(
        EvmBroadcastResp,
        `/v1/evm/${chainId}/broadcast`,
        { method: "POST", body: JSON.stringify({ rawTx }) },
      );
      return body.txHash;
    },
    async broadcastSol(signedTxBase64: string): Promise<string> {
      z.string().min(8).parse(signedTxBase64);
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signedTxBase64)) throw new Error("bad signed bytes");
      const body = await request(
        SolBroadcastResp,
        `/v1/sol/broadcast`,
        { method: "POST", body: JSON.stringify({ rawTx: signedTxBase64 }) },
      );
      return body.txSig;
    },
    async broadcastBtc(psbtBase64: string): Promise<string> {
      z.string().min(8).parse(psbtBase64);
      const raw = Buffer.from(psbtBase64, "base64");
      if (raw.length < 5 || raw.subarray(0, 5).toString("binary") !== "psbt\xff") {
        throw new Error("psbt magic");
      }
      const body = await request(
        BtcBroadcastResp,
        `/v1/btc/broadcast`,
        { method: "POST", body: JSON.stringify({ rawTx: psbtBase64 }) },
      );
      return body.txid;
    },
    async broadcastAda(signedTxHex: string): Promise<string> {
      z.string().regex(/^[0-9a-fA-F]+$/).parse(signedTxHex);
      if (signedTxHex.length < 8) throw new Error("signed tx too short");
      const body = await request(
        AdaBroadcastResp,
        `/v1/ada/broadcast`,
        { method: "POST", body: JSON.stringify({ rawTx: signedTxHex }) },
      );
      return body.txHash;
    },
    async getPhishlist(): Promise<{ domains: string[]; updatedAt: string }> {
      const body = await request(PhishlistResp, `/v1/phishlist`);
      return { domains: body.domains, updatedAt: body.updatedAt };
    },
    async getPricesHistory(assets: string[], span: "1d" | "7d" | "30d" | "1y"): Promise<PriceSeries> {
      const list = z.array(z.string().regex(/^[A-Z]{2,10}$/)).min(1).parse(assets);
      z.enum(["1d", "7d", "30d", "1y"]).parse(span);
      const body = await request(HistoryResp, `/v1/prices/history?assets=${list.join(",")}&span=${span}`);
      return body;
    },
    async getSolBalance(address: string): Promise<bigint> {
      z.string().min(32).max(44).parse(address);
      const body = await request(SolBalanceResp, `/v1/sol/balance/${address}`);
      return BigInt(body.lamports);
    },
    async getBtcUtxos(address: string): Promise<unknown[]> {
      z.string().min(1).parse(address);
      const body = await request(UtxosResp, `/v1/btc/utxo/${encodeURIComponent(address)}`);
      return body.utxos;
    },
    async getAdaUtxos(address: string): Promise<unknown[]> {
      z.string().min(1).parse(address);
      const body = await request(UtxosResp, `/v1/ada/utxo/${encodeURIComponent(address)}`);
      return body.utxos;
    },
    async evmRpc<T>(chainId: number, method: string, params: unknown[]): Promise<{ stub: boolean; result: T | null }> {
      z.number().int().positive().parse(chainId);
      z.string().min(1).max(64).parse(method);
      z.array(z.unknown()).parse(params);
      const body = await request(RpcPassthroughResp, `/v1/evm/${chainId}/rpc`, {
        method: "POST",
        body: JSON.stringify({ method, params }),
      });
      return { stub: body.stub, result: body.result as T | null };
    },
    async getFeeEstimate(chainId: number, input: { from: string; to: string; data?: string; value?: string }): Promise<FeeEstimate> {
      z.number().int().positive().parse(chainId);
      const q = new URLSearchParams({ from: input.from, to: input.to });
      if (input.data !== undefined) q.set("data", input.data);
      if (input.value !== undefined) q.set("value", input.value);
      const body = await request(FeeEstimateResp, `/v1/evm/${chainId}/fee-estimate?${q.toString()}`);
      const tier = (t: z.infer<typeof FeeTier>): FeeTierBig => ({
        maxFeePerGasWei: BigInt(t.maxFeePerGasWei),
        maxPriorityFeePerGasWei: BigInt(t.maxPriorityFeePerGasWei),
      });
      return {
        stub: body.stub,
        gasLimit: BigInt(body.gasLimit),
        tiers: { low: tier(body.tiers.low), med: tier(body.tiers.med), high: tier(body.tiers.high) },
      };
    },
    async getEvmTokenBalances(chainId: number, address: string, tokens?: string[]): Promise<{ stub: boolean; tokens: EvmTokenBalance[] }> {
      z.number().int().positive().parse(chainId);
      z.string().regex(/^0x[0-9a-fA-F]{40}$/).parse(address);
      const qs = tokens && tokens.length > 0 ? `?tokens=${tokens.map((t) => encodeURIComponent(t)).join(",")}` : "";
      const body = await request(EvmTokensResp, `/v1/evm/${chainId}/tokens/${address}${qs}`);
      return {
        stub: body.stub,
        tokens: body.tokens.map((t) => ({ ...t, balanceBaseUnits: BigInt(t.balanceBaseUnits) })),
      };
    },
    async getEvmTxStatus(chainId: number, hash: string): Promise<TxStatus> {
      z.number().int().positive().parse(chainId);
      z.string().regex(/^0x[0-9a-fA-F]{64}$/).parse(hash);
      const body = await request(EvmTxStatusResp, `/v1/evm/${chainId}/tx/${hash}`);
      return {
        stub: body.stub,
        status: body.status,
        blockNumber: body.blockNumber === null ? null : BigInt(body.blockNumber),
        gasUsed: body.gasUsed === null ? null : BigInt(body.gasUsed),
      };
    },
    async getSolTokenBalances(address: string): Promise<{ stub: boolean; tokens: SplBalance[] }> {
      z.string().min(32).max(44).parse(address);
      const body = await request(SolTokensResp, `/v1/sol/tokens/${address}`);
      return {
        stub: body.stub,
        tokens: body.tokens.map((t) => ({ ...t, amountBaseUnits: BigInt(t.amountBaseUnits) })),
      };
    },
    async getSolTxStatus(sig: string): Promise<SolTxStatus> {
      z.string().min(64).max(88).parse(sig);
      const body = await request(SolTxStatusResp, `/v1/sol/tx/${sig}`);
      return { stub: body.stub, status: body.status, slot: body.slot, err: body.err };
    },
    async getSwapQuote(input: { chain: string; sellToken: string; buyToken: string; sellAmountBaseUnits: string; slippageBps: number; taker?: string }): Promise<{ stub: boolean; quote: SwapQuote | null }> {
      const parsed = z
        .object({
          chain: z.string().min(1),
          sellToken: z.string().min(1),
          buyToken: z.string().min(1),
          sellAmountBaseUnits: UintStr,
          slippageBps: z.number().int().min(1).max(5000),
          taker: z.string().optional(),
        })
        .parse(input);
      const body = await request(SwapQuoteResp, `/v1/swap/quote`, { method: "POST", body: JSON.stringify(parsed) });
      if (body.quote === null) return { stub: body.stub, quote: null };
      const qq = body.quote;
      return {
        stub: body.stub,
        quote: {
          sellToken: qq.sellToken,
          buyToken: qq.buyToken,
          sellAmountBaseUnits: BigInt(qq.sellAmountBaseUnits),
          buyAmountBaseUnits: BigInt(qq.buyAmountBaseUnits),
          priceImpactPct: qq.priceImpactPct,
          allowanceNeededBaseUnits: qq.allowanceNeededBaseUnits === undefined ? undefined : BigInt(qq.allowanceNeededBaseUnits),
          routeId: qq.routeId,
        },
      };
    },
    async getNfts(chain: string, address: string): Promise<{ stub: boolean; items: Nft[] }> {
      z.string().min(1).parse(chain);
      z.string().min(1).parse(address);
      const body = await request(NftsResp, `/v1/nfts/${encodeURIComponent(chain)}/${encodeURIComponent(address)}`);
      return { stub: body.stub, items: body.items };
    },
    async getHealth(): Promise<Health> {
      const body = await request(HealthResp, `/healthz`);
      return body;
    },
    async simulateEvm(input: { chainId: string; from: string; to: string; dataHex?: string; valueWei?: string }): Promise<SimDiff> {
      const parsed = z
        .object({
          chainId: z.string().min(1),
          from: z.string().min(1),
          to: z.string().min(1),
          dataHex: z.string().regex(/^0x[0-9a-fA-F]*$/).optional(),
          valueWei: UintStr.optional(),
        })
        .parse(input);
      const body = await request(SimResp, `/v1/evm/simulate`, { method: "POST", body: JSON.stringify(parsed) });
      return {
        stub: body.stub,
        diff: body.diff === null ? null : {
          balanceChanges: body.diff.balanceChanges.map((c) => ({ ...c, before: BigInt(c.before), after: BigInt(c.after) })),
        },
      };
    },
    async simulateSol(input: { messageBase64?: string; transactionBase64?: string }): Promise<SimDiff> {
      const parsed = z
        .object({ messageBase64: z.string().min(1).optional(), transactionBase64: z.string().min(1).optional() })
        .parse(input);
      const body = await request(SimResp, `/v1/sol/simulate`, { method: "POST", body: JSON.stringify(parsed) });
      return {
        stub: body.stub,
        diff: body.diff === null ? null : {
          balanceChanges: body.diff.balanceChanges.map((c) => ({ ...c, before: BigInt(c.before), after: BigInt(c.after) })),
        },
      };
    },
    async revokePush(hashedAddrHex: string): Promise<{ ok: true }> {
      if (!/^[0-9a-f]{64}$/.test(hashedAddrHex)) throw new Error("hashedAddr must be sha256 hex");
      return request(PushSubscribeResp, `/v1/push/revoke`, { method: "POST", body: JSON.stringify({ hashedAddrHex }) });
    },
    async subscribePush(hashedAddrHex: string, pushToken: string): Promise<{ ok: true }> {
      const body = pushSubscribeBody(hashedAddrHex, pushToken);
      return request(PushSubscribeResp, `/v1/push/subscribe`, {
        method: "POST",
        body: JSON.stringify({ hashedAddrHex: body.hashedAddrHex, pushToken: body.pushToken }),
      });
    },
  };
}
