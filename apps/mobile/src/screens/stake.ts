// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import {
  buildAdaDelegateIntent,
  buildAdaUndelegateIntent,
  buildRewardsRow,
  buildSolDelegateIntent,
  buildSolStakeIntent,
  buildSolUndelegateIntent,
  claimedRewards,
  type RewardsRow,
  type StakeIntent,
} from "@drift/features";
import { formatUnits } from "../money.js";
import { screenChrome, type ScreenChrome } from "../watchonly.js";

// Stake screen view-model (iteration 3): SOL + ADA intents via features
// builders, rewards rows, watch-only gating on the submit CTA.

export type StakeAction = "sol-stake" | "sol-delegate" | "sol-undelegate" | "ada-delegate" | "ada-undelegate";

export interface StakeRequest {
  action: StakeAction;
  from?: string;
  validatorVote?: string;
  poolId?: string;
  stakeAddress?: string;
  lamports?: string;
}

export interface StakeScreenRow {
  intent: StakeIntent;
  /** Human amount line, e.g. "1.5 SOL" (bigint-formatted). */
  amountLine: string | null;
  hints: string[];
}

export interface StakeScreenModel {
  rows: StakeScreenRow[];
  rewards: Array<{ row: RewardsRow; claimedBaseUnits: bigint; claimedLine: string }>;
  canSubmit: boolean;
  chrome: ScreenChrome;
}

const RE_BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const RE_POOL = /^[0-9a-fA-F]{56}$/;

/** Build one stake intent row; throws on invalid input (zod). */
export function stakeRow(req: StakeRequest): StakeScreenRow {
  const r = z.object({
    action: z.enum(["sol-stake", "sol-delegate", "sol-undelegate", "ada-delegate", "ada-undelegate"]),
    from: z.string().optional(),
    validatorVote: z.string().optional(),
    poolId: z.string().optional(),
    stakeAddress: z.string().optional(),
    lamports: z.string().regex(/^\d+$/).optional(),
  }).parse(req);
  let intent: StakeIntent;
  switch (r.action) {
    case "sol-stake": {
      if (!r.from || !RE_BASE58.test(r.from)) throw new Error("bad from");
      if (!r.validatorVote || !RE_BASE58.test(r.validatorVote)) throw new Error("bad validator");
      intent = buildSolStakeIntent(r.from, r.validatorVote, r.lamports ?? "0");
      break;
    }
    case "sol-delegate": {
      if (!r.from || !RE_BASE58.test(r.from)) throw new Error("bad from");
      if (!r.validatorVote || !RE_BASE58.test(r.validatorVote)) throw new Error("bad validator");
      intent = buildSolDelegateIntent(r.from, r.validatorVote, r.lamports ?? "0");
      break;
    }
    case "sol-undelegate": {
      if (!r.from || !RE_BASE58.test(r.from)) throw new Error("bad from");
      intent = buildSolUndelegateIntent(r.from, r.lamports ?? "0");
      break;
    }
    case "ada-delegate": {
      if (!r.stakeAddress) throw new Error("bad stake address");
      if (!r.poolId || !RE_POOL.test(r.poolId)) throw new Error("bad pool id");
      intent = buildAdaDelegateIntent(r.stakeAddress, r.poolId);
      break;
    }
    case "ada-undelegate": {
      if (!r.stakeAddress) throw new Error("bad stake address");
      intent = buildAdaUndelegateIntent(r.stakeAddress);
      break;
    }
  }
  const amountLine = intent.display.amountBaseUnits === "0"
    ? null
    : `${formatUnits(BigInt(intent.display.amountBaseUnits), intent.chain.startsWith("solana") ? 9 : 6)} ${intent.chain.startsWith("solana") ? "SOL" : "ADA"}`;
  return { intent, amountLine, hints: intent.display.hints };
}

/** Rewards rows with claimed amounts formatted. */
export function rewardsView(rows: RewardsRow[]): Array<{ row: RewardsRow; claimedBaseUnits: bigint; claimedLine: string }> {
  const list = z.array(z.object({
    chain: z.string(), asset: z.string(), pendingBaseUnits: z.string().regex(/^\d+$/),
    lifetimeBaseUnits: z.string().regex(/^\d+$/), decimals: z.number().int().min(0).max(36),
  })).parse(rows);
  return list.map((r) => {
    const row = buildRewardsRow(r.chain, r.asset, r.pendingBaseUnits, r.lifetimeBaseUnits, r.decimals);
    const claimed = claimedRewards(row);
    return {
      row,
      claimedBaseUnits: claimed,
      claimedLine: `${formatUnits(claimed, row.decimals)} ${row.asset}`,
    };
  });
}

export function stakeScreenModel(
  requests: StakeRequest[],
  rewards: RewardsRow[],
  opts?: { watchOnly?: boolean },
): StakeScreenModel {
  const chrome = screenChrome(opts?.watchOnly ?? false);
  return {
    rows: z.array(z.unknown()).parse(requests).map((r) => stakeRow(r as StakeRequest)),
    rewards: rewardsView(rewards),
    canSubmit: chrome.canSign,
    chrome,
  };
}
