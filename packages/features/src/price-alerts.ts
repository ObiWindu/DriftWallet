// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

/**
 * Watchlist + price alerts (local evaluation only — no network, no PII).
 *
 * The watchlist is an ordered set of assets the user follows. Alert rules are
 * evaluated purely against price series supplied by the caller (fetched via
 * the gateway by the app shell). Rules:
 *  - priceAbove / priceBelow: absolute USD threshold, fires on strict crossing.
 *  - pctMove: |change| over the visible series >= thresholdBps.
 */

// ---------------------------------------------------------------- watchlist

export const WatchItemSchema = z.object({
  asset: z.string().regex(/^[A-Z0-9]{2,10}$/),
  note: z.string().max(120).optional(),
  addedAt: z.number().int().nonnegative(),
});
export type WatchItem = z.infer<typeof WatchItemSchema>;

export const WatchlistExportSchema = z.object({
  version: z.literal(1),
  items: z.array(WatchItemSchema),
});

export class Watchlist {
  private items = new Map<string, WatchItem>();

  add(asset: string, nowMs?: number, note?: string): WatchItem {
    const a = z.string().regex(/^[A-Z0-9]{2,10}$/).parse(asset.trim().toUpperCase());
    const now = nowMs ?? Date.now();
    z.number().int().nonnegative().parse(now);
    const item = WatchItemSchema.parse({ asset: a, note: note?.slice(0, 120), addedAt: now });
    this.items.set(a, item);
    return item;
  }

  remove(asset: string): boolean {
    return this.items.delete(asset.trim().toUpperCase());
  }

  has(asset: string): boolean {
    return this.items.has(asset.trim().toUpperCase());
  }

  list(): WatchItem[] {
    return [...this.items.values()];
  }

  assets(): string[] {
    return this.list().map((i) => i.asset);
  }

  exportJSON(): string {
    return JSON.stringify(WatchlistExportSchema.parse({ version: 1, items: this.list() }));
  }

  importJSON(json: string): WatchItem[] {
    const parsed = WatchlistExportSchema.parse(JSON.parse(json) as unknown);
    this.items.clear();
    for (const it of parsed.items) this.items.set(it.asset, it);
    return this.list();
  }
}

// ---------------------------------------------------------------- alert rules

export const AlertRuleV2Schema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("priceAbove"),
    id: z.string().min(1),
    asset: z.string().regex(/^[A-Z0-9]{2,10}$/),
    thresholdUsd: z.number().positive().finite(),
  }),
  z.object({
    kind: z.literal("priceBelow"),
    id: z.string().min(1),
    asset: z.string().regex(/^[A-Z0-9]{2,10}$/),
    thresholdUsd: z.number().positive().finite(),
  }),
  z.object({
    kind: z.literal("pctMove"),
    id: z.string().min(1),
    asset: z.string().regex(/^[A-Z0-9]{2,10}$/),
    /** Fire when |change| over the supplied series >= this many bps. */
    thresholdBps: z.number().int().positive().max(1_000_000),
  }),
]);
export type AlertRuleV2 = z.infer<typeof AlertRuleV2Schema>;

export const AlertHitSchema = z.object({
  ruleId: z.string(),
  asset: z.string(),
  kind: z.enum(["priceAbove", "priceBelow", "pctMove"]),
  title: z.string(),
  body: z.string(),
  at: z.number().int().nonnegative(),
});
export type AlertHit = z.infer<typeof AlertHitSchema>;

const Point = z.object({ t: z.number().int().nonnegative(), p: z.number().finite().nonnegative() });

/**
 * Evaluate rules against a tick: current prices plus per-asset series for
 * pctMove rules. Returns hits; never throws on unknown assets (rule simply
 * does not fire).
 */
export function evaluateAlerts(
  rules: AlertRuleV2[],
  tick: { prices: Record<string, number>; series?: Record<string, { t: number; p: number }[]> },
  nowMs?: number,
): AlertHit[] {
  const parsed = z.array(AlertRuleV2Schema).parse(rules);
  const prices = z.record(z.string(), z.number().finite()).parse(tick.prices);
  const series = z.record(z.string(), z.array(Point)).parse(tick.series ?? {});
  const now = nowMs ?? Date.now();
  z.number().int().nonnegative().parse(now);
  const hits: AlertHit[] = [];

  for (const rule of parsed) {
    const price = prices[rule.asset];
    if (rule.kind === "priceAbove" && price !== undefined && price > rule.thresholdUsd) {
      hits.push(AlertHitSchema.parse({
        ruleId: rule.id, asset: rule.asset, kind: rule.kind,
        title: `${rule.asset} above $${rule.thresholdUsd}`,
        body: `${rule.asset} is now $${price}`,
        at: now,
      }));
    } else if (rule.kind === "priceBelow" && price !== undefined && price < rule.thresholdUsd) {
      hits.push(AlertHitSchema.parse({
        ruleId: rule.id, asset: rule.asset, kind: rule.kind,
        title: `${rule.asset} below $${rule.thresholdUsd}`,
        body: `${rule.asset} is now $${price}`,
        at: now,
      }));
    } else if (rule.kind === "pctMove") {
      const pts = series[rule.asset];
      if (pts && pts.length >= 2) {
        const first = pts[0] as { t: number; p: number };
        const last = pts[pts.length - 1] as { t: number; p: number };
        if (first.p > 0) {
          const bps = Math.abs(Math.round(((last.p - first.p) / first.p) * 10_000));
          if (bps >= rule.thresholdBps) {
            const sign = last.p >= first.p ? "+" : "-";
            hits.push(AlertHitSchema.parse({
              ruleId: rule.id, asset: rule.asset, kind: rule.kind,
              title: `${rule.asset} moved ${sign}${(bps / 100).toFixed(2)}%`,
              body: `${rule.asset}: $${first.p} -> $${last.p}`,
              at: now,
            }));
          }
        }
      }
    }
  }
  return hits;
}

/** Build the default rule set for a watchlist asset (above/below at +/-10%). */
export function defaultRulesFor(asset: string, currentUsd: number, idPrefix = "auto"): AlertRuleV2[] {
  const a = z.string().regex(/^[A-Z0-9]{2,10}$/).parse(asset.toUpperCase());
  z.number().positive().finite().parse(currentUsd);
  const mk = (kind: "priceAbove" | "priceBelow", factor: number): AlertRuleV2 =>
    AlertRuleV2Schema.parse({
      kind,
      id: `${idPrefix}:${a}:${kind}`,
      asset: a,
      thresholdUsd: Math.round(currentUsd * factor * 100) / 100,
    });
  return [mk("priceAbove", 1.1), mk("priceBelow", 0.9)];
}
