// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  ADA_STAKE_DEPOSIT_LOVELACE,
  buildAdaDelegateIntent,
  buildAdaUndelegateIntent,
  buildRewardsRow,
  buildSolDelegateIntent,
  buildSolStakeIntent,
  buildSolUndelegateIntent,
  claimedRewards,
  SOL_STAKE_MINIMUM_LAMPORTS,
} from "./staking.js";

const VOTE = "Vote111111111111111111111111111111111111111";
const FROM = "From111111111111111111111111111111111111111";
const POOL = "ab".repeat(28); // 56 hex chars

describe("staking", () => {
  it("builds SOL stake/delegate/undelegate intents with minimums", () => {
    const stake = buildSolStakeIntent(FROM, VOTE, 1_000_000_000n);
    expect(stake.action).toBe("stake");
    expect(stake.display.amountBaseUnits).toBe("1000000000");
    expect(stake.display.hints).toHaveLength(0);
    expect(stake.signerRequest).toMatchObject({ kind: "stake", from: FROM });

    const dust = buildSolStakeIntent(FROM, VOTE, SOL_STAKE_MINIMUM_LAMPORTS);
    expect(dust.display.hints.length).toBeGreaterThan(0); // below 1 SOL note

    const delegate = buildSolDelegateIntent(FROM, VOTE, "2000000000");
    expect(delegate.action).toBe("delegate");
    const undelegate = buildSolUndelegateIntent(FROM, "2000000000");
    expect(undelegate.action).toBe("undelegate");
    expect(undelegate.display.hints[0]).toMatch(/cooldown/);

    expect(() => buildSolStakeIntent(FROM, VOTE, 999_999n)).toThrow();
    expect(() => buildSolStakeIntent("not-base58!!", VOTE, 1_000_000_000n)).toThrow();
    expect(() => buildSolStakeIntent(FROM, "0x1234", 1_000_000_000n)).toThrow();
  });

  it("builds ADA pool delegation with hex56 pool id + 2 ADA deposit", () => {
    const stakeAddr = "stake1uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    const d = buildAdaDelegateIntent(stakeAddr, POOL);
    expect(d.action).toBe("delegate");
    expect(d.signerRequest).toMatchObject({
      kind: "delegate",
      poolId: POOL,
      depositLovelace: ADA_STAKE_DEPOSIT_LOVELACE.toString(),
    });
    expect(ADA_STAKE_DEPOSIT_LOVELACE).toBe(2_000_000n);
    const u = buildAdaUndelegateIntent(stakeAddr);
    expect(u.signerRequest).toMatchObject({ kind: "undelegate" });
    expect(() => buildAdaDelegateIntent(stakeAddr, "deadbeef")).toThrow();
    expect(() => buildAdaDelegateIntent(stakeAddr, "zz".repeat(28))).toThrow();
  });

  it("models rewards rows with bigint math", () => {
    const row = buildRewardsRow("solana:mainnet", "SOL", 50_000n, 1_000_000n, 9);
    expect(row.pendingBaseUnits).toBe("50000");
    expect(claimedRewards(row)).toBe(950_000n);
    expect(typeof claimedRewards(row)).toBe("bigint");
    expect(() => buildRewardsRow("solana:mainnet", "SOL", 2_000_000n, 1_000_000n, 9)).toThrow();
    expect(() => buildRewardsRow("solana:mainnet", "SOL", "1.5", "10", 9)).toThrow();
  });
});
