// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import { formatFiatCents, formatUnits } from "../money.js";

// Home screen view-model (U011). Portfolio totals over bigint balances,
// chain tabs, testnet banner. Reads come from gateway-client query specs;
// this module only shapes them for display (never calls fetch).

export const AssetBalanceSchema = z.object({
  chainId: z.string().min(1).max(128),
  symbol: z.string().min(1).max(16),
  totalBaseUnits: z.bigint().min(0n),
  decimals: z.number().int().min(0).max(36),
  priceCents: z.bigint().min(0n),
});
export type AssetBalance = z.infer<typeof AssetBalanceSchema>;

export interface PortfolioTotals {
  totalFiat: string;
  assetCount: number;
  emptyKey: "home.empty" | null;
}

export function portfolioSummary(balances: AssetBalance[]): PortfolioTotals {
  const list = z.array(AssetBalanceSchema).parse(balances);
  let totalCents = 0n;
  for (const b of list) {
    totalCents += (b.totalBaseUnits * b.priceCents) / 10n ** BigInt(b.decimals);
  }
  const dollars = totalCents / 100n;
  const cents = (totalCents % 100n).toString().padStart(2, "0");
  return {
    totalFiat: `$${dollars.toString()}.${cents}`,
    assetCount: list.length,
    emptyKey: list.length === 0 ? "home.empty" : null,
  };
}

export interface AssetRow {
  chainId: string;
  symbol: string;
  amount: string;
  fiat: string;
}

export function assetRows(balances: AssetBalance[]): AssetRow[] {
  const list = z.array(AssetBalanceSchema).parse(balances);
  return list.map((b) => ({
    chainId: b.chainId,
    symbol: b.symbol,
    amount: `${formatUnits(b.totalBaseUnits, b.decimals)} ${b.symbol}`,
    fiat: formatFiatCents(b.totalBaseUnits, b.decimals, b.priceCents),
  }));
}

const CHAIN_LABELS: Record<string, string> = {
  "eip155:1": "Ethereum",
  "eip155:56": "BNB",
  "eip155:137": "Polygon",
  "eip155:42161": "Arbitrum",
  "eip155:8453": "Base",
  "solana:mainnet": "Solana",
  "bip122:000000000019d6689c085ae165831e93": "Bitcoin",
  "cardano:mainnet": "Cardano",
};

export interface ChainTab {
  chainId: string;
  label: string;
  selected: boolean;
}

/** Tabs for the 8 supported mainnet chains (mirrors store ALLOWED_CHAINS). */
export function chainTabs(selected: string): ChainTab[] {
  const sel = z.string().parse(selected);
  return Object.entries(CHAIN_LABELS).map(([chainId, label]) => ({ chainId, label, selected: chainId === sel }));
}

export function homeBanner(mainnetEnabled: boolean): { bannerKey: "home.testnetBanner" } | null {
  z.boolean().parse(mainnetEnabled);
  return mainnetEnabled ? null : { bannerKey: "home.testnetBanner" };
}
