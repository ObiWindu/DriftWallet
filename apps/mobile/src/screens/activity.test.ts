// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { activityList, activitySummary, explorerTxUrl } from "./activity.js";

const TX = "a".repeat(64);

describe("activity screen VM", () => {
  it("sorts newest-first with exact amounts", () => {
    const rows = activityList(
      [
        { id: "old", chainId: "eip155:1", status: "confirmed", amountBaseUnits: 1_000_000_000_000_000_000n, decimals: 18, symbol: "ETH", txHash: TX, spam: false, timestampMs: 1000 },
        { id: "new", chainId: "eip155:1", status: "pending", amountBaseUnits: 500_000_000_000_000_000n, decimals: 18, symbol: "ETH", txHash: TX, spam: false, timestampMs: 2000 },
      ],
      false,
    );
    expect(rows.map((r) => r.id)).toEqual(["new", "old"]);
    expect(rows[0]?.statusKey).toBe("activity.pending");
    expect(rows[1]?.amount).toBe("1 ETH");
  });

  it("hides spam tokens when toggled", () => {
    const mk = (spam: boolean, id: string) => ({
      chainId: "solana:mainnet", status: "confirmed" as const, amountBaseUnits: 1n, decimals: 9,
      symbol: "SCAM", txHash: "b".repeat(64), spam, timestampMs: 1, id,
    });
    expect(activityList([mk(true, "s"), mk(false, "ok")], true).map((r) => r.id)).toEqual(["ok"]);
    expect(activityList([mk(true, "s"), mk(false, "ok")], false).length).toBe(2);
  });

  it("builds explorer links per chain and null for unknown", () => {
    expect(explorerTxUrl("eip155:1", TX)).toBe(`https://etherscan.io/tx/${TX}`);
    expect(explorerTxUrl("solana:mainnet", TX)).toBe(`https://solscan.io/tx/${TX}`);
    expect(explorerTxUrl("bip122:000000000019d6689c085ae165831e93", TX)).toContain("mempool.space");
    expect(explorerTxUrl("cardano:mainnet", TX)).toContain("cardanoscan.io");
    expect(explorerTxUrl("mystery:9", TX)).toBe(null);
    expect(() => explorerTxUrl("eip155:1", "not a hash!!")).toThrow();
  });

  it("summarizes statuses and empty state", () => {
    const mk = (status: "pending" | "confirmed" | "failed", id: string) => ({
      chainId: "eip155:1", status, amountBaseUnits: 0n, decimals: 18, symbol: "ETH",
      txHash: TX, spam: false, timestampMs: 1, id,
    });
    expect(activitySummary([mk("pending", "a"), mk("confirmed", "b"), mk("failed", "c")])).toEqual({
      pending: 1, confirmed: 1, failed: 1, emptyKey: null,
    });
    expect(activitySummary([]).emptyKey).toBe("activity.empty");
  });
});
