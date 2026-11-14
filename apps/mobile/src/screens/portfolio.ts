// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import {
  aggregatePortfolio,
  changeBps,
  downsampleSeries,
  type Holding,
  type PricePoint,
} from "@drift/features";
import { formatFiatCents, formatUnits } from "../money.js";
import { screenChrome, type ScreenChrome } from "../watchonly.js";
import type { AssetBalance } from "./home.js";

// Portfolio screen view-model (iteration 3): allocation %, sparkline, 24h
// change, stale-price flags, P&L vs cost basis. All money bigint; fiat from
// integer cents. Reuses @drift/features portfolio math.

/** USD cents (bigint) -> exact 2-decimal price string for features Holding. */
export function centsToPriceStr(cents: bigint): string {
  if (cents < 0n) throw new Error("bad price cents");
  const d = cents / 100n;
  const c = (cents % 100n).toString().padStart(2, "0");
  return `${d.toString()}.${c}`;
}

export interface PortfolioViewInput {
  balances: AssetBalance[];
  /** Optional cost basis per `ASSET@chainId` in USD cents (for P&L). */
  costBasisCents?: Record<string, string>;
  /** Sparkline series per asset (from gateway /v1/prices/history). */
  series?: Record<string, PricePoint[]>;
  watchOnly?: boolean;
  nowMs?: number;
}

export interface AllocationRow {
  chainId: string;
  symbol: string;
  amount: string;
  fiat: string;
  pctBps: number;
  pnlUsdCents: string | null;
}

export interface PortfolioView {
  totalFiat: string;
  rows: AllocationRow[];
  staleAssets: string[];
  sparkline: PricePoint[];
  changeBps24h: string | null;
  totalPnlUsdCents: string | null;
  chrome: ScreenChrome;
}

export function portfolioView(input: PortfolioViewInput): PortfolioView {
  const now = input.nowMs ?? Date.now();
  const list = z.array(z.object({
    chainId: z.string().min(1),
    symbol: z.string().min(1),
    totalBaseUnits: z.bigint().min(0n),
    decimals: z.number().int().min(0).max(36),
    priceCents: z.bigint().min(0n),
  })).parse(input.balances);
  const costBasis = z.record(z.string(), z.string().regex(/^\d+$/)).parse(input.costBasisCents ?? {});
  const seriesIn = z.record(z.string(), z.array(z.object({ t: z.number().int().nonnegative(), p: z.number().finite().nonnegative() }))).parse(input.series ?? {});
  const chrome = screenChrome(input.watchOnly ?? false);

  const holdings: Holding[] = list.map((b) => ({
    chain: b.chainId,
    asset: b.symbol.toUpperCase().slice(0, 10),
    symbol: b.symbol,
    balanceBaseUnits: b.totalBaseUnits.toString(),
    decimals: b.decimals,
    priceUsd: b.priceCents === 0n ? null : centsToPriceStr(b.priceCents),
    priceAtMs: now,
    costBasisUsdCents: costBasis[`${b.symbol.toUpperCase().slice(0, 10)}@${b.chainId}`],
  }));

  const summary = aggregatePortfolio(holdings, { nowMs: now });
  const totalCents = BigInt(summary.totalUsdCents);
  const dollars = totalCents / 100n;
  const cents = (totalCents % 100n).toString().padStart(2, "0");

  const rows: AllocationRow[] = summary.allocation.map((a) => {
    const src = list.find((b) => b.chainId === a.chain && b.symbol === a.symbol);
    return {
      chainId: a.chain,
      symbol: a.symbol,
      amount: src ? `${formatUnits(src.totalBaseUnits, src.decimals)} ${src.symbol}` : a.symbol,
      fiat: src ? formatFiatCents(src.totalBaseUnits, src.decimals, src.priceCents) : `$${(BigInt(a.usdCents) / 100n).toString()}.${(BigInt(a.usdCents) % 100n).toString().padStart(2, "0")}`,
      pctBps: a.pctBps,
      pnlUsdCents: summary.pnlUsdCents?.[`${a.asset}@${a.chain}`] ?? null,
    };
  });

  // sparkline + 24h change for the largest holding (or first series given)
  const mainAsset = rows[0]?.symbol.toUpperCase();
  const mainSeries = (mainAsset !== undefined ? seriesIn[mainAsset] : undefined) ?? Object.values(seriesIn)[0] ?? [];
  const sparkline = downsampleSeries(mainSeries, 32);
  const change = mainSeries.length >= 2 ? changeBps(mainSeries) : null;

  const pnlTotal = summary.pnlUsdCents ? Object.values(summary.pnlUsdCents).reduce((a, v) => a + BigInt(v), 0n) : null;

  return {
    totalFiat: `$${dollars.toString()}.${cents}`,
    rows,
    staleAssets: summary.staleAssets,
    sparkline,
    changeBps24h: change,
    totalPnlUsdCents: pnlTotal === null ? null : pnlTotal.toString(),
    chrome,
  };
}
