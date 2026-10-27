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

export interface CreateGatewayClientInput {
  baseUrl: string;
  apiKey?: string;
  fetchFn?: FetchFn;
}

export interface GatewayClient {
  getPrices(assets: string[]): Promise<Record<string, number>>;
  getEvmBalance(chainId: number, address: string): Promise<bigint>;
  broadcastEvm(chainId: number, rawTx: string): Promise<string>;
  broadcastSol(signedTxBase64: string): Promise<string>;
  broadcastBtc(psbtBase64: string): Promise<string>;
  broadcastAda(signedTxHex: string): Promise<string>;
  getPhishlist(): Promise<{ domains: string[]; updatedAt: string }>;
  subscribePush(hashedAddrHex: string, pushToken: string): Promise<{ ok: true }>;
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
    async subscribePush(hashedAddrHex: string, pushToken: string): Promise<{ ok: true }> {
      const body = pushSubscribeBody(hashedAddrHex, pushToken);
      return request(PushSubscribeResp, `/v1/push/subscribe`, {
        method: "POST",
        body: JSON.stringify({ hashedAddrHex: body.hashedAddrHex, pushToken: body.pushToken }),
      });
    },
  };
}
