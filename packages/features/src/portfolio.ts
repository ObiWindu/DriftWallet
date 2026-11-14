// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

/**
 * I076 — Portfolio intelligence.
 *
 * Cross-chain aggregation with STRICT integer money math: fiat values are
 * integer USD cents (bigint), prices are exact decimal strings converted to
 * cents. No float ever touches an amount. Prices may be null (unknown) or
 * flagged stale — those holdings contribute 0 to the total and are listed in
 * `staleAssets` so the UI can show "price unavailable" instead of a lie.
 */

// ---------------------------------------------------------------- schemas

const UintStr = z.string().regex(/^\d+$/);
/** Exact USD price as a decimal string, e.g. "3200.50" (max 4 decimals). */
const PriceStr = z.string().regex(/^\d+(\.\d{1,4})?$/);

export const HoldingSchema = z.object({
  chain: z.string().min(1),
  asset: z.string().regex(/^[A-Z0-9]{2,10}$/),
  symbol: z.string().min(1).max(12),
  balanceBaseUnits: UintStr,
  decimals: z.number().int().min(0).max(36),
  /** Exact USD price, or null when unknown. */
  priceUsd: PriceStr.nullable(),
  /** When the price was last refreshed (ms). Old prices are "stale". */
  priceAtMs: z.number().int().nonnegative().optional(),
  /** Optional cost basis in USD cents (integer) for P&L. */
  costBasisUsdCents: UintStr.optional(),
});
export type Holding = z.infer<typeof HoldingSchema>;

export const AllocationEntrySchema = z.object({
  chain: z.string(),
  asset: z.string(),
  symbol: z.string(),
  usdCents: UintStr,
  /** Share of total in basis points (0..10000). 0 when total is 0. */
  pctBps: z.number().int().min(0).max(10000),
});
export type AllocationEntry = z.infer<typeof AllocationEntrySchema>;

export const PortfolioSummarySchema = z.object({
  /** Total portfolio value in USD cents. */
  totalUsdCents: UintStr,
  allocation: z.array(AllocationEntrySchema),
  /** Assets whose price was missing or stale — excluded from the total. */
  staleAssets: z.array(z.string()),
  /** Per-holding unrealized P&L in USD cents (only when cost basis given). */
  pnlUsdCents: z.record(z.string(), z.string().regex(/^-?\d+$/)).optional(),
});
export type PortfolioSummary = z.infer<typeof PortfolioSummarySchema>;

export const PricePointSchema = z.object({ t: z.number().int().nonnegative(), p: z.number().finite().nonnegative() });
export type PricePoint = z.infer<typeof PricePointSchema>;

// ---------------------------------------------------------------- helpers

/** Exact decimal USD price -> integer 1e-4 USD units ("micro-USD", bigint). */
export function priceToMicroUsd(priceUsd: string): bigint {
  const p = PriceStr.parse(priceUsd.trim());
  const [d, c = ""] = p.split(".");
  return BigInt(d ?? "0") * 10_000n + BigInt((c + "0000").slice(0, 4));
}

/** Holding balance (base units) * price -> USD cents, integer math. */
export function holdingValueUsdCents(h: Holding): bigint {
  HoldingSchema.parse(h);
  if (h.priceUsd === null) return 0n;
  const micro = priceToMicroUsd(h.priceUsd);
  return (BigInt(h.balanceBaseUnits) * micro) / (10n ** BigInt(h.decimals) * 100n);
}

// ---------------------------------------------------------------- aggregation

export const STALE_PRICE_MS = 5 * 60_000;

/**
 * Aggregate holdings into a portfolio summary. Holdings with null price or a
 * price older than `staleMs` (default 5 min, relative to `nowMs`) are excluded
 * from the total and reported in `staleAssets`.
 */
export function aggregatePortfolio(holdings: Holding[], opts?: { nowMs?: number; staleMs?: number }): PortfolioSummary {
  const list = z.array(HoldingSchema).parse(holdings);
  const now = opts?.nowMs ?? Date.now();
  const staleMs = opts?.staleMs ?? STALE_PRICE_MS;
  z.number().int().nonnegative().parse(now);

  const entries: { h: Holding; cents: bigint; stale: boolean }[] = [];
  const staleAssets: string[] = [];
  for (const h of list) {
    const stale =
      h.priceUsd === null || (h.priceAtMs !== undefined && now - h.priceAtMs > staleMs);
    if (stale) staleAssets.push(`${h.asset}@${h.chain}`);
    entries.push({ h, cents: stale ? 0n : holdingValueUsdCents(h), stale });
  }

  const total = entries.reduce((acc, e) => acc + e.cents, 0n);
  const allocation: AllocationEntry[] = entries
    .filter((e) => !e.stale && e.cents > 0n)
    .map((e) => ({
      chain: e.h.chain,
      asset: e.h.asset,
      symbol: e.h.symbol,
      usdCents: e.cents.toString(),
      pctBps: total > 0n ? Number((e.cents * 10_000n) / total) : 0,
    }))
    .sort((a, b) => (BigInt(b.usdCents) > BigInt(a.usdCents) ? 1 : -1));

  const pnl: Record<string, string> = {};
  let hasPnl = false;
  for (const e of entries) {
    if (e.h.costBasisUsdCents !== undefined && !e.stale) {
      const key = `${e.h.asset}@${e.h.chain}`;
      pnl[key] = (e.cents - BigInt(e.h.costBasisUsdCents)).toString();
      hasPnl = true;
    }
  }

  return PortfolioSummarySchema.parse({
    totalUsdCents: total.toString(),
    allocation,
    staleAssets,
    ...(hasPnl ? { pnlUsdCents: pnl } : {}),
  });
}

/** Total P&L across holdings that have a cost basis (USD cents, may be negative). */
export function totalPnlUsdCents(summary: PortfolioSummary): bigint {
  PortfolioSummarySchema.parse(summary);
  if (!summary.pnlUsdCents) return 0n;
  return Object.values(summary.pnlUsdCents).reduce((acc, v) => acc + BigInt(v), 0n);
}

// ---------------------------------------------------------------- series

/**
 * Downsample a price series to at most `maxPoints`, preserving first/last
 * and local min/max per bucket (so sparklines keep their shape). Pure.
 */
export function downsampleSeries(series: PricePoint[], maxPoints: number): PricePoint[] {
  const pts = z.array(PricePointSchema).parse(series);
  z.number().int().min(1).parse(maxPoints);
  if (pts.length <= maxPoints) return pts;
  const bucket = pts.length / maxPoints;
  const out: PricePoint[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const start = Math.floor(i * bucket);
    const end = Math.min(pts.length, Math.max(start + 1, Math.floor((i + 1) * bucket)));
    let min = pts[start] as PricePoint;
    let max = pts[start] as PricePoint;
    for (let j = start; j < end; j++) {
      const p = pts[j] as PricePoint;
      if (p.p < min.p) min = p;
      if (p.p > max.p) max = p;
    }
    out.push(i === 0 ? (pts[0] as PricePoint) : min.p <= max.p ? min : max);
    if (i === maxPoints - 1) out[out.length - 1] = pts[pts.length - 1] as PricePoint;
  }
  return out.map((p) => PricePointSchema.parse(p));
}

/** Price change over a series in basis points (string, may be negative). */
export function changeBps(series: PricePoint[]): string {
  const pts = z.array(PricePointSchema).min(2).parse(series);
  const first = pts[0] as PricePoint;
  const last = pts[pts.length - 1] as PricePoint;
  if (first.p === 0) throw new Error("first price is 0");
  const bps = Math.round(((last.p - first.p) / first.p) * 10_000);
  return String(bps);
}
