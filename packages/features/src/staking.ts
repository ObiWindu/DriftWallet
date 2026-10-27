// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

/**
 * U042 — Staking intents (SOL + ADA; EVM liquid-staking is display-only).
 *
 * Pure builders: each returns a human `display` row for the approval UI plus
 * a `signerRequest` payload shaped like the existing chain request dicts
 * (`evmReq` / `solanaReq` style). Structural only — no cross-package imports
 * so this package never depends on signer internals.
 */

// ---------------------------------------------------------------- constants

/** Rent-exempt floor for a stake account, in lamports. */
export const SOL_STAKE_MINIMUM_LAMPORTS = 1_000_000n;
/**
 * Recommended delegation floor: 1 SOL (1_000_000_000 lamports). Amounts below
 * this are still built, but flagged with a `belowRecommended` hint so the UI
 * can nudge — tiny stakes earn dust and waste rent.
 */
export const SOL_STAKE_RECOMMENDED_LAMPORTS = 1_000_000_000n;
/** Cardano key-deposit for a stake-address registration, in lovelace. */
export const ADA_STAKE_DEPOSIT_LOVELACE = 2_000_000n;

const RE_BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const RE_POOL_HEX56 = /^[0-9a-fA-F]{56}$/;
const UintStr = z.string().regex(/^\d+$/);

// ---------------------------------------------------------------- schemas

export const SolanaReqSchema = z.object({
  kind: z.enum(["stake", "delegate", "undelegate"]),
  from: z.string().regex(RE_BASE58),
  validatorVote: z.string().regex(RE_BASE58).optional(),
  lamports: z.string().regex(/^\d+$/),
});
export type SolanaReq = z.infer<typeof SolanaReqSchema>;

export const CardanoReqSchema = z.object({
  kind: z.enum(["delegate", "undelegate"]),
  stakeAddress: z.string().min(1),
  poolId: z.string().regex(RE_POOL_HEX56).optional(),
  depositLovelace: z.string().regex(/^\d+$/),
});
export type CardanoReq = z.infer<typeof CardanoReqSchema>;

export const StakeIntentSchema = z.object({
  chain: z.string().min(1),
  action: z.enum(["stake", "delegate", "undelegate"]),
  display: z.object({
    title: z.string(),
    validator: z.string().optional(),
    amountBaseUnits: z.string().regex(/^\d+$/),
    hints: z.array(z.string()),
  }),
  signerRequest: z.union([SolanaReqSchema, CardanoReqSchema]),
});
export type StakeIntent = z.infer<typeof StakeIntentSchema>;

export const RewardsRowSchema = z.object({
  chain: z.string().min(1),
  asset: z.string().min(1),
  pendingBaseUnits: z.string().regex(/^\d+$/),
  lifetimeBaseUnits: z.string().regex(/^\d+$/),
  decimals: z.number().int().min(0).max(36),
});
export type RewardsRow = z.infer<typeof RewardsRowSchema>;

// ---------------------------------------------------------------- builders

function lamports(amount: bigint | string): bigint {
  const v = BigInt(UintStr.parse(String(amount)));
  if (v < SOL_STAKE_MINIMUM_LAMPORTS) {
    throw new Error(`stake amount below minimum ${SOL_STAKE_MINIMUM_LAMPORTS} lamports`);
  }
  return v;
}

/** SOL: create + delegate a stake account in one intent. */
export function buildSolStakeIntent(from: string, validatorVote: string, lamportsAmount: bigint | string): StakeIntent {
  z.string().regex(RE_BASE58).parse(from);
  z.string().regex(RE_BASE58).parse(validatorVote);
  const v = lamports(lamportsAmount);
  const hints = v < SOL_STAKE_RECOMMENDED_LAMPORTS
    ? ["below the recommended 1 SOL delegation — rewards may be dust"]
    : [];
  return StakeIntentSchema.parse({
    chain: "solana:mainnet",
    action: "stake",
    display: {
      title: "Stake SOL",
      validator: validatorVote,
      amountBaseUnits: v.toString(),
      hints,
    },
    signerRequest: { kind: "stake", from, validatorVote, lamports: v.toString() },
  });
}

/** SOL: delegate an existing stake account to another validator. */
export function buildSolDelegateIntent(from: string, validatorVote: string, lamportsAmount: bigint | string): StakeIntent {
  z.string().regex(RE_BASE58).parse(from);
  z.string().regex(RE_BASE58).parse(validatorVote);
  const v = lamports(lamportsAmount);
  return StakeIntentSchema.parse({
    chain: "solana:mainnet",
    action: "delegate",
    display: {
      title: "Delegate SOL",
      validator: validatorVote,
      amountBaseUnits: v.toString(),
      hints: v < SOL_STAKE_RECOMMENDED_LAMPORTS ? ["below the recommended 1 SOL delegation"] : [],
    },
    signerRequest: { kind: "delegate", from, validatorVote, lamports: v.toString() },
  });
}

/** SOL: deactivate a stake account (funds unlock after cooldown). */
export function buildSolUndelegateIntent(from: string, lamportsAmount: bigint | string): StakeIntent {
  z.string().regex(RE_BASE58).parse(from);
  const v = BigInt(UintStr.parse(String(lamportsAmount)));
  return StakeIntentSchema.parse({
    chain: "solana:mainnet",
    action: "undelegate",
    display: {
      title: "Undelegate SOL",
      amountBaseUnits: v.toString(),
      hints: ["funds unlock after the cooldown period (~2-3 days)"],
    },
    signerRequest: { kind: "undelegate", from, lamports: v.toString() },
  });
}

/** ADA: delegate a stake address to a pool (poolId = 28-byte hex, 56 chars). */
export function buildAdaDelegateIntent(stakeAddress: string, poolId: string): StakeIntent {
  z.string().min(1).parse(stakeAddress);
  z.string().regex(RE_POOL_HEX56).parse(poolId);
  return StakeIntentSchema.parse({
    chain: "cardano:mainnet",
    action: "delegate",
    display: {
      title: "Delegate ADA",
      validator: poolId,
      amountBaseUnits: "0",
      hints: [`2 ADA key deposit (${ADA_STAKE_DEPOSIT_LOVELACE} lovelace) refunded on undelegate`],
    },
    signerRequest: {
      kind: "delegate",
      stakeAddress,
      poolId: poolId.toLowerCase(),
      depositLovelace: ADA_STAKE_DEPOSIT_LOVELACE.toString(),
    },
  });
}

/** ADA: undelegate (deregister) a stake address; deposit is refunded. */
export function buildAdaUndelegateIntent(stakeAddress: string): StakeIntent {
  z.string().min(1).parse(stakeAddress);
  return StakeIntentSchema.parse({
    chain: "cardano:mainnet",
    action: "undelegate",
    display: {
      title: "Undelegate ADA",
      amountBaseUnits: "0",
      hints: [`2 ADA key deposit (${ADA_STAKE_DEPOSIT_LOVELACE} lovelace) refunded`],
    },
    signerRequest: {
      kind: "undelegate",
      stakeAddress,
      depositLovelace: ADA_STAKE_DEPOSIT_LOVELACE.toString(),
    },
  });
}

// ---------------------------------------------------------------- rewards

/** Portfolio rewards row. All money stays bigint; callers format for display. */
export function buildRewardsRow(
  chain: string,
  asset: string,
  pendingBaseUnits: bigint | string,
  lifetimeBaseUnits: bigint | string,
  decimals: number,
): RewardsRow {
  const pending = BigInt(UintStr.parse(String(pendingBaseUnits)));
  const lifetime = BigInt(UintStr.parse(String(lifetimeBaseUnits)));
  if (pending > lifetime) throw new Error("pending rewards cannot exceed lifetime rewards");
  return RewardsRowSchema.parse({
    chain: z.string().min(1).parse(chain),
    asset: z.string().min(1).parse(asset),
    pendingBaseUnits: pending.toString(),
    lifetimeBaseUnits: lifetime.toString(),
    decimals: z.number().int().min(0).max(36).parse(decimals),
  });
}

/** Claimed so far = lifetime - pending (both bigint strings). */
export function claimedRewards(row: RewardsRow): bigint {
  RewardsRowSchema.parse(row);
  return BigInt(row.lifetimeBaseUnits) - BigInt(row.pendingBaseUnits);
}
