// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// TanStack Query layer (SPEC §2: @tanstack/react-query data layer, headless
// query-core here; React bindings attach in the RN/extension shells).
// Cache times mirror the gateway: balances 30s, prices 60s.
import { QueryClient } from "@tanstack/query-core";
import type { GatewayClient } from "./index.js";

export const STALE_BALANCE_MS = 30_000;
export const STALE_PRICE_MS = 60_000;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 2, staleTime: STALE_BALANCE_MS, gcTime: 5 * 60_000 },
    },
  });
}

export interface QuerySpec<T> {
  queryKey: (string | number)[];
  queryFn: () => Promise<T>;
  staleTime: number;
}

export function pricesQuery(client: GatewayClient, assets: string[]): QuerySpec<Record<string, number>> {
  return {
    queryKey: ["prices", ...assets],
    queryFn: () => client.getPrices(assets),
    staleTime: STALE_PRICE_MS,
  };
}

export function evmBalanceQuery(
  client: GatewayClient,
  chainId: number,
  address: string,
): QuerySpec<bigint> {
  return {
    queryKey: ["evm-balance", chainId, address],
    queryFn: () => client.getEvmBalance(chainId, address),
    staleTime: STALE_BALANCE_MS,
  };
}

export function phishlistQuery(
  client: GatewayClient,
): QuerySpec<{ domains: string[]; updatedAt: string }> {
  return {
    queryKey: ["phishlist"],
    queryFn: () => client.getPhishlist(),
    staleTime: STALE_PRICE_MS,
  };
}

// ---- Iteration 3 query specs ----

export function solBalanceQuery(client: GatewayClient, address: string): QuerySpec<bigint> {
  return {
    queryKey: ["sol-balance", address],
    queryFn: () => client.getSolBalance(address),
    staleTime: STALE_BALANCE_MS,
  };
}

export function evmTokenBalancesQuery(
  client: GatewayClient,
  chainId: number,
  address: string,
  tokens?: string[],
): QuerySpec<{ stub: boolean; tokens: import("./index.js").EvmTokenBalance[] }> {
  return {
    queryKey: ["evm-tokens", chainId, address, ...(tokens ?? [])],
    queryFn: () => client.getEvmTokenBalances(chainId, address, tokens),
    staleTime: STALE_BALANCE_MS,
  };
}

export function solTokenBalancesQuery(
  client: GatewayClient,
  address: string,
): QuerySpec<{ stub: boolean; tokens: import("./index.js").SplBalance[] }> {
  return {
    queryKey: ["sol-tokens", address],
    queryFn: () => client.getSolTokenBalances(address),
    staleTime: STALE_BALANCE_MS,
  };
}

export function evmTxStatusQuery(
  client: GatewayClient,
  chainId: number,
  hash: string,
): QuerySpec<import("./index.js").TxStatus> {
  return {
    queryKey: ["evm-tx", chainId, hash],
    queryFn: () => client.getEvmTxStatus(chainId, hash),
    staleTime: 15_000,
  };
}

export function solTxStatusQuery(
  client: GatewayClient,
  sig: string,
): QuerySpec<import("./index.js").SolTxStatus> {
  return {
    queryKey: ["sol-tx", sig],
    queryFn: () => client.getSolTxStatus(sig),
    staleTime: 15_000,
  };
}

export function pricesHistoryQuery(
  client: GatewayClient,
  assets: string[],
  span: "1d" | "7d" | "30d" | "1y",
): QuerySpec<import("./index.js").PriceSeries> {
  return {
    queryKey: ["prices-history", span, ...assets],
    queryFn: () => client.getPricesHistory(assets, span),
    staleTime: 5 * 60_000,
  };
}

export function feeEstimateQuery(
  client: GatewayClient,
  chainId: number,
  input: { from: string; to: string; data?: string; value?: string },
): QuerySpec<import("./index.js").FeeEstimate> {
  return {
    queryKey: ["fee", chainId, input.from, input.to, input.data ?? "", input.value ?? ""],
    queryFn: () => client.getFeeEstimate(chainId, input),
    staleTime: STALE_BALANCE_MS,
  };
}

export function nftsQuery(
  client: GatewayClient,
  chain: string,
  address: string,
): QuerySpec<{ stub: boolean; items: import("./index.js").Nft[] }> {
  return {
    queryKey: ["nfts", chain, address],
    queryFn: () => client.getNfts(chain, address),
    staleTime: 60_000,
  };
}

export function swapQuoteQuery(
  client: GatewayClient,
  input: { chain: string; sellToken: string; buyToken: string; sellAmountBaseUnits: string; slippageBps: number; taker?: string },
): QuerySpec<{ stub: boolean; quote: import("./index.js").SwapQuote | null }> {
  return {
    queryKey: ["swap-quote", input.chain, input.sellToken, input.buyToken, input.sellAmountBaseUnits, input.slippageBps],
    queryFn: () => client.getSwapQuote(input),
    staleTime: 20_000,
  };
}
