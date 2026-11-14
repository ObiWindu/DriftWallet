// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// Iteration 3 — wire the gateway client + feature models into the extension
// view-models. Pure async functions over an injected GatewayClient (structural
// subset), so tests use a stub client and no network. All money stays bigint;
// fiat renders from integer cents via the existing popup model.

import { z } from "zod";
import type { GatewayClient } from "@drift/gateway-client";
import {
  aggregatePortfolio,
  buildSwapParams,
  fetchSwapQuote,
  reviewSwap,
  resolveRecipient,
  type Holding,
  type Quote,
  type ResolveNameFn,
  type SwapParams,
  type SwapReview,
} from "@drift/features";
import { buildPortfolioModel, type PortfolioAsset, type PortfolioModel } from "./popup.js";
import { ActivityItem, type SettingsModel, visibleActivity } from "./app-model.js";

/** Structural subset of GatewayClient used here (keeps tests light). */
export interface PortfolioGateway {
  getPrices(assets: string[]): Promise<Record<string, number>>;
  getEvmBalance(chainId: number, address: string): Promise<bigint>;
  getSolBalance(address: string): Promise<bigint>;
  getEvmTokenBalances(chainId: number, address: string, tokens?: string[]): Promise<{ stub: boolean; tokens: { address: string; symbol?: string | undefined; decimals?: number | undefined; balanceBaseUnits: bigint }[] }>;
  getSolTokenBalances(address: string): Promise<{ stub: boolean; tokens: { mint: string; tokenAccount: string; amountBaseUnits: bigint; decimals?: number | undefined }[] }>;
  getEvmTxStatus(chainId: number, hash: string): Promise<{ stub: boolean; status: "pending" | "success" | "failed" | "unknown"; blockNumber: bigint | null; gasUsed: bigint | null }>;
  getSolTxStatus(sig: string): Promise<{ stub: boolean; status: "pending" | "success" | "failed" | "unknown"; slot: number | null; err: unknown }>;
  getSwapQuote(input: { chain: string; sellToken: string; buyToken: string; sellAmountBaseUnits: string; slippageBps: number; taker?: string }): Promise<{ stub: boolean; quote: { sellToken: string; buyToken: string; sellAmountBaseUnits: bigint; buyAmountBaseUnits: bigint; priceImpactPct: string; allowanceNeededBaseUnits?: bigint | undefined; routeId?: string | undefined } | null }>;
}

export interface AccountView {
  name: string;
  /** CAIP-2 chain -> address for this account. */
  addresses: Record<string, string>;
}

const NATIVE_META: Record<string, { asset: string; symbol: string; decimals: number }> = {
  "eip155:1": { asset: "ETH", symbol: "ETH", decimals: 18 },
  "eip155:56": { asset: "BNB", symbol: "BNB", decimals: 18 },
  "eip155:137": { asset: "POL", symbol: "POL", decimals: 18 },
  "eip155:42161": { asset: "ETH", symbol: "ETH", decimals: 18 },
  "eip155:8453": { asset: "ETH", symbol: "ETH", decimals: 18 },
  "eip155:11155111": { asset: "ETH", symbol: "ETH", decimals: 18 },
  "solana:mainnet": { asset: "SOL", symbol: "SOL", decimals: 9 },
  "solana:devnet": { asset: "SOL", symbol: "SOL", decimals: 9 },
};

const EVM_NUM: Record<string, number> = {
  "eip155:1": 1, "eip155:56": 56, "eip155:137": 137, "eip155:42161": 42161, "eip155:8453": 8453,
  "eip155:11155111": 11155111,
};

/** Fetch holdings for one account across its chains. Never throws on a failed read (balance = 0, price null). */
export async function loadHoldings(
  client: PortfolioGateway,
  account: AccountView,
  opts?: { nowMs?: number; priceAtMs?: number },
): Promise<Holding[]> {
  z.string().min(1).parse(account.name);
  const now = opts?.nowMs ?? Date.now();
  const priceAt = opts?.priceAtMs ?? now;
  const chains = Object.keys(account.addresses);
  const assets = [...new Set(chains.map((c) => NATIVE_META[c]?.asset).filter((a): a is string => a !== undefined))];
  let prices: Record<string, number> = {};
  try {
    prices = assets.length > 0 ? await client.getPrices(assets) : {};
  } catch {
    prices = {};
  }
  const priceStr = (asset: string): string | null => {
    const p = prices[asset];
    return typeof p === "number" && Number.isFinite(p) && p > 0 ? p.toFixed(4) : null;
  };

  const out: Holding[] = [];
  for (const chain of chains) {
    const addr = account.addresses[chain] as string;
    const meta = NATIVE_META[chain];
    if (!meta) continue;
    let bal = 0n;
    try {
      if (chain.startsWith("eip155:")) {
        const num = EVM_NUM[chain];
        if (num !== undefined) bal = await client.getEvmBalance(num, addr);
      } else if (chain.startsWith("solana:")) {
        bal = await client.getSolBalance(addr);
      }
    } catch {
      bal = 0n;
    }
    out.push({
      chain,
      asset: meta.asset,
      symbol: meta.symbol,
      balanceBaseUnits: bal.toString(),
      decimals: meta.decimals,
      priceUsd: priceStr(meta.asset),
      priceAtMs: priceAt,
    });
    // tokens
    try {
      if (chain.startsWith("eip155:")) {
        const num = EVM_NUM[chain];
        if (num !== undefined) {
          const tb = await client.getEvmTokenBalances(num, addr);
          for (const t of tb.tokens) {
            if (t.balanceBaseUnits <= 0n) continue;
            const asset = (t.symbol ?? "TKN").toUpperCase().slice(0, 10);
            out.push({
              chain, asset, symbol: t.symbol ?? "TKN",
              balanceBaseUnits: t.balanceBaseUnits.toString(),
              decimals: t.decimals ?? 18,
              priceUsd: priceStr(asset), priceAtMs: priceAt,
            });
          }
        }
      } else if (chain.startsWith("solana:")) {
        const tb = await client.getSolTokenBalances(addr);
        for (const t of tb.tokens) {
          if (t.amountBaseUnits <= 0n) continue;
          const asset = `SPL-${t.mint.slice(0, 4).toUpperCase()}`;
          out.push({
            chain, asset, symbol: "SPL",
            balanceBaseUnits: t.amountBaseUnits.toString(),
            decimals: t.decimals ?? 9,
            priceUsd: null, priceAtMs: priceAt, // SPL prices not in default price feed
          });
        }
      }
    } catch { /* token read failure is non-fatal */ }
  }
  return out;
}

export interface PortfolioView {
  popup: PortfolioModel;
  summary: ReturnType<typeof aggregatePortfolio>;
  holdings: Holding[];
}

/** Full portfolio view: popup rows (bigint-cents) + allocation summary. */
export async function loadPortfolioView(
  client: PortfolioGateway,
  account: AccountView,
  opts?: { nowMs?: number },
): Promise<PortfolioView> {
  const now = opts?.nowMs ?? Date.now();
  const holdings = await loadHoldings(client, account, { nowMs: now });
  const summary = aggregatePortfolio(holdings, { nowMs: now });
  // popup's AssetSchema accepts max 2-decimal price strings — truncate (display only;
  // the exact 4-decimal price is what the allocation summary uses).
  const price2 = (p: string): string => {
    const [d, f = ""] = p.split(".");
    return `${d}.${(f + "00").slice(0, 2)}`;
  };
  const assets: PortfolioAsset[] = holdings
    .filter((h) => h.priceUsd !== null)
    .map((h) => ({
      chain: h.chain,
      symbol: h.symbol,
      balanceMinor: h.balanceBaseUnits,
      decimals: h.decimals,
      priceUsd: price2(h.priceUsd as string),
    }));
  const popup = buildPortfolioModel(assets, new Date(now).toISOString());
  return { popup, summary, holdings };
}

// ---------------------------------------------------------------- activity

export interface PendingTx {
  chain: string;
  txHash: string;
  kind: string;
  at: number;
  hiddenAsSpam?: boolean;
}

/** Poll gateway for statuses and build ActivityItem rows (app-model schema). */
export async function loadActivity(
  client: PortfolioGateway,
  txs: PendingTx[],
  settings: SettingsModel,
): Promise<ActivityItem[]> {
  const list = z.array(z.object({ chain: z.string(), txHash: z.string(), kind: z.string(), at: z.number().int().nonnegative(), hiddenAsSpam: z.boolean().optional() })).parse(txs);
  const items: ActivityItem[] = [];
  for (const t of list) {
    let status: ActivityItem["status"] = "pending";
    try {
      if (t.chain.startsWith("eip155:")) {
        const num = EVM_NUM[t.chain];
        if (num !== undefined) {
          const s = await client.getEvmTxStatus(num, t.txHash);
          if (s.status === "success") status = "confirmed";
          else if (s.status === "failed") status = "failed";
        }
      } else if (t.chain.startsWith("solana:")) {
        const s = await client.getSolTxStatus(t.txHash);
        if (s.status === "success") status = "confirmed";
        else if (s.status === "failed") status = "failed";
      }
    } catch { /* stays pending */ }
    items.push(ActivityItem.parse({
      id: `${t.chain}:${t.txHash}`,
      chain: t.chain,
      kind: t.kind,
      status,
      txHash: t.txHash,
      hiddenAsSpam: t.hiddenAsSpam ?? false,
      at: t.at,
    }));
  }
  return visibleActivity(items, settings);
}

// ---------------------------------------------------------------- swap

export interface SwapViewModel {
  review: SwapReview;
  /** Validated quote (string base units, features shape). */
  quote: Quote;
}

/**
 * Full swap review: params -> gateway quote -> features reviewSwap with the
 * current on-chain allowance. Throws when the gateway has no live quote.
 */
export async function loadSwapReview(
  client: PortfolioGateway,
  rawParams: unknown,
  currentAllowanceBaseUnits: bigint | string,
  allowanceOpts?: { allowInfinite?: boolean; reason?: string },
): Promise<SwapViewModel> {
  const params: SwapParams = buildSwapParams(rawParams);
  const fetched = await fetchSwapQuote(params, async (p) => {
    const r = await client.getSwapQuote({
      chain: p.chain,
      sellToken: p.sellToken,
      buyToken: p.buyToken,
      sellAmountBaseUnits: p.amountBaseUnits,
      slippageBps: p.slippageBps,
      ...(p.recipient ? { taker: p.recipient } : {}),
    });
    if (r.quote === null) throw new Error("no live quote (gateway stub)");
    return {
      sellToken: r.quote.sellToken,
      buyToken: r.quote.buyToken,
      sellAmountBaseUnits: r.quote.sellAmountBaseUnits.toString(),
      buyAmountBaseUnits: r.quote.buyAmountBaseUnits.toString(),
      priceImpactPct: r.quote.priceImpactPct,
      allowanceNeededBaseUnits: r.quote.allowanceNeededBaseUnits?.toString(),
      routeId: r.quote.routeId,
    };
  });
  const review = reviewSwap(params, fetched, currentAllowanceBaseUnits, allowanceOpts);
  return { review, quote: fetched };
}

// ---------------------------------------------------------------- recipient

export interface RecipientDeps {
  resolveName: ResolveNameFn;
  knownHistory?: string[];
}

/** Resolve + validate a send recipient via the features pipeline (EVM/Solana address rules from core). */
export async function resolveSendRecipient(
  chainId: string,
  rawInput: string,
  deps: RecipientDeps,
  validateAddress: (chainId: string, addr: string) => boolean,
) {
  return resolveRecipient(chainId, rawInput, {
    resolveName: deps.resolveName,
    validateAddress,
    knownHistory: deps.knownHistory ?? [],
  });
}

/** Structural check that a value satisfies the GatewayClient surface we use. */
export function assertPortfolioGateway(c: unknown): asserts c is PortfolioGateway {
  const g = c as GatewayClient;
  for (const k of ["getPrices", "getEvmBalance", "getSolBalance", "getEvmTokenBalances", "getSolTokenBalances", "getEvmTxStatus", "getSolTxStatus", "getSwapQuote"] as const) {
    if (typeof (g as unknown as Record<string, unknown>)[k] !== "function") throw new Error(`gateway client missing ${k}`);
  }
}
