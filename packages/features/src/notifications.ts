// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

/**
 * U045 — Notifications: price alerts, tx-confirmed pushes, security pushes.
 *
 * Privacy contract (mirrors gateway-client `pushSubscribeBody`): only sha256
 * hex of addresses leaves the device. This module enforces that locally —
 * subscribe payload builders reject raw addresses.
 */

// ---------------------------------------------------------------- schemas

export const RE_SHA256_HEX = /^[0-9a-f]{64}$/;

export const AlertRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("priceAbove"),
    id: z.string().min(1),
    asset: z.string().regex(/^[A-Z]{2,10}$/),
    thresholdUsd: z.number().positive().finite(),
  }),
  z.object({
    kind: z.literal("priceBelow"),
    id: z.string().min(1),
    asset: z.string().regex(/^[A-Z]{2,10}$/),
    thresholdUsd: z.number().positive().finite(),
  }),
  z.object({
    kind: z.literal("txConfirmed"),
    id: z.string().min(1),
    /** sha256 hex of the watched address — never the raw address. */
    hashedAddrHex: z.string().regex(RE_SHA256_HEX),
    txHash: z.string().min(1),
  }),
  z.object({
    kind: z.literal("newOrigin"),
    id: z.string().min(1),
    origin: z.string().url(),
  }),
]);
export type AlertRule = z.infer<typeof AlertRuleSchema>;

export const TickSchema = z.object({
  /** Asset -> current USD price (server ticks; evaluated locally). */
  prices: z.record(z.string(), z.number().nonnegative().finite()),
  /** Confirmed tx hashes observed since the last tick. */
  confirmedTx: z.array(z.string().min(1)),
  /** Newly seen dApp origins since the last tick. */
  seenOrigins: z.array(z.string()),
});
export type Tick = z.infer<typeof TickSchema>;

export const NotificationSchema = z.object({
  id: z.string().min(1),
  ruleId: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  at: z.number().int().nonnegative(),
});
export type Notification = z.infer<typeof NotificationSchema>;

// ---------------------------------------------------------------- evaluation

/**
 * Pure local evaluation: match rules against a tick. Price thresholds use
 * strict crossing semantics (above: price > threshold; below: price <
 * threshold) so repeated ticks re-fire only via queue dedupe policy.
 */
export function evaluateTicks(rules: AlertRule[], tick: Tick, nowMs?: number): Notification[] {
  const parsedRules = z.array(AlertRuleSchema).parse(rules);
  const t = TickSchema.parse(tick);
  const now = nowMs ?? Date.now();
  z.number().int().nonnegative().parse(now);
  const out: Notification[] = [];

  for (const rule of parsedRules) {
    switch (rule.kind) {
      case "priceAbove": {
        const price = t.prices[rule.asset];
        if (price !== undefined && price > rule.thresholdUsd) {
          out.push({
            id: `${rule.id}:${now}`,
            ruleId: rule.id,
            title: `${rule.asset} above $${rule.thresholdUsd}`,
            body: `${rule.asset} is now $${price}`,
            at: now,
          });
        }
        break;
      }
      case "priceBelow": {
        const price = t.prices[rule.asset];
        if (price !== undefined && price < rule.thresholdUsd) {
          out.push({
            id: `${rule.id}:${now}`,
            ruleId: rule.id,
            title: `${rule.asset} below $${rule.thresholdUsd}`,
            body: `${rule.asset} is now $${price}`,
            at: now,
          });
        }
        break;
      }
      case "txConfirmed": {
        if (t.confirmedTx.includes(rule.txHash)) {
          out.push({
            id: `${rule.id}:${now}`,
            ruleId: rule.id,
            title: "Transaction confirmed",
            body: `Transaction ${rule.txHash.slice(0, 10)}… confirmed`,
            at: now,
          });
        }
        break;
      }
      case "newOrigin": {
        if (t.seenOrigins.includes(rule.origin)) {
          out.push({
            id: `${rule.id}:${now}`,
            ruleId: rule.id,
            title: "New connection",
            body: `${rule.origin} connected — tap to review or revoke`,
            at: now,
          });
        }
        break;
      }
    }
  }
  return out.map((n) => NotificationSchema.parse(n));
}

// ---------------------------------------------------------------- subscribe

/**
 * Build a push-subscribe payload. Accepts ONLY sha256 hex — raw addresses
 * (0x…, base58, bech32) are rejected so plaintext identifiers can never be
 * subscribed. Mirrors the gateway-client `pushSubscribeBody` contract.
 */
export function buildSubscribePayload(hashedAddrHex: string, pushToken: string): {
  hashedAddrHex: string;
  pushToken: string;
} {
  if (!RE_SHA256_HEX.test(hashedAddrHex)) {
    throw new Error("hashedAddrHex must be sha256 hex (raw addresses are rejected)");
  }
  if (pushToken.length < 8) throw new Error("bad push token");
  if (/^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44}|(addr1|stake1)[0-9a-z]+)$/.test(pushToken)) {
    throw new Error("push token must not be an address");
  }
  return { hashedAddrHex: hashedAddrHex.toLowerCase(), pushToken };
}

// ---------------------------------------------------------------- queue

export const MAX_QUEUE_SIZE = 100;

/** In-memory notification queue with capacity cap + id dedupe. */
export class NotificationQueue {
  private items: Notification[] = [];
  private seenIds = new Set<string>();

  push(n: Notification): boolean {
    const parsed = NotificationSchema.parse(n);
    if (this.seenIds.has(parsed.id)) return false; // dedupe
    this.seenIds.add(parsed.id);
    this.items.push(parsed);
    while (this.items.length > MAX_QUEUE_SIZE) {
      const dropped = this.items.shift();
      if (dropped) this.seenIds.delete(dropped.id);
    }
    return true;
  }

  list(): Notification[] {
    return [...this.items];
  }

  clear(): void {
    this.items = [];
    this.seenIds.clear();
  }

  get size(): number {
    return this.items.length;
  }
}
