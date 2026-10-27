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
