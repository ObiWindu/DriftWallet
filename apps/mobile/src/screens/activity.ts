// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import { formatUnits } from "../money.js";

// Activity screen view-model (U013). Shapes gateway history items into
// sorted display rows with explorer links and spam filtering.

export const ActivityItemSchema = z.object({
  id: z.string().min(1).max(128),
  chainId: z.string().min(1).max(128),
  status: z.enum(["pending", "confirmed", "failed"]),
  amountBaseUnits: z.bigint(),
  decimals: z.number().int().min(0).max(36),
  symbol: z.string().min(1).max(16),
  txHash: z.string().regex(/^[0-9a-zA-Z]+$/).max(128),
  spam: z.boolean().default(false),
  timestampMs: z.number().int().min(0),
});
export type ActivityItem = z.infer<typeof ActivityItemSchema>;

const EXPLORERS: Array<{ prefix: string; url: (hash: string) => string }> = [
  { prefix: "eip155:1", url: (h) => `https://etherscan.io/tx/${h}` },
  { prefix: "eip155:56", url: (h) => `https://bscscan.com/tx/${h}` },
  { prefix: "eip155:137", url: (h) => `https://polygonscan.com/tx/${h}` },
  { prefix: "eip155:42161", url: (h) => `https://arbiscan.io/tx/${h}` },
  { prefix: "eip155:8453", url: (h) => `https://basescan.org/tx/${h}` },
  { prefix: "eip155:", url: (h) => `https://blockscan.com/tx/${h}` },
  { prefix: "solana:mainnet", url: (h) => `https://solscan.io/tx/${h}` },
  { prefix: "solana:", url: (h) => `https://solscan.io/tx/${h}?cluster=devnet` },
  { prefix: "bip122:", url: (h) => `https://mempool.space/tx/${h}` },
  { prefix: "cardano:", url: (h) => `https://cardanoscan.io/transaction/${h}` },
];

/** Explorer link for a tx, or null when the chain has no known explorer. */
export function explorerTxUrl(chainId: string, txHash: string): string | null {
  const id = z.string().parse(chainId);
  const hash = z.string().regex(/^[0-9a-zA-Z]+$/).max(128).parse(txHash);
  for (const e of EXPLORERS) {
    if (id.startsWith(e.prefix)) return e.url(hash);
  }
  return null;
}

export type ActivityStatusKey = "activity.pending" | "activity.confirmed" | "activity.failed";
const STATUS_KEY: Record<ActivityItem["status"], ActivityStatusKey> = {
  pending: "activity.pending",
  confirmed: "activity.confirmed",
  failed: "activity.failed",
};

export interface ActivityRow {
  id: string;
  statusKey: ActivityStatusKey;
  amount: string;
  explorerUrl: string | null;
  spam: boolean;
}

export function activityList(items: ActivityItem[], hideSpam: boolean): ActivityRow[] {
  const list = z.array(ActivityItemSchema).parse(items);
  z.boolean().parse(hideSpam);
  return list
    .filter((i) => !hideSpam || !i.spam)
    .sort((a, b) => b.timestampMs - a.timestampMs)
    .map((i) => ({
      id: i.id,
      statusKey: STATUS_KEY[i.status],
      amount: `${formatUnits(i.amountBaseUnits, i.decimals)} ${i.symbol}`,
      explorerUrl: explorerTxUrl(i.chainId, i.txHash),
      spam: i.spam,
    }));
}

export function activitySummary(items: ActivityItem[]): {
  pending: number;
  confirmed: number;
  failed: number;
  emptyKey: "activity.empty" | null;
} {
  const list = z.array(ActivityItemSchema).parse(items);
  let pending = 0;
  let confirmed = 0;
  let failed = 0;
  for (const i of list) {
    if (i.status === "pending") pending++;
    else if (i.status === "confirmed") confirmed++;
    else failed++;
  }
  return { pending, confirmed, failed, emptyKey: list.length === 0 ? "activity.empty" : null };
}
