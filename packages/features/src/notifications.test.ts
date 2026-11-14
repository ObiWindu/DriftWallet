// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  buildRevokePayload,
  buildSubscribePayload,
  evaluateTicks,
  NotificationQueue,
  RevokeList,
  securityEvent,
  type AlertRule,
} from "./notifications.js";

const HASH = "ab".repeat(32); // 64 hex chars

describe("notifications", () => {
  it("evaluates priceAbove/priceBelow ticks locally", () => {
    const rules: AlertRule[] = [
      { kind: "priceAbove", id: "r1", asset: "SOL", thresholdUsd: 100 },
      { kind: "priceBelow", id: "r2", asset: "BTC", thresholdUsd: 50_000 },
    ];
    const fired = evaluateTicks(
      rules,
      { prices: { SOL: 120, BTC: 40_000 }, confirmedTx: [], seenOrigins: [] },
      1000,
    );
    expect(fired).toHaveLength(2);
    expect(fired.map((n) => n.ruleId).sort()).toEqual(["r1", "r2"]);

    const quiet = evaluateTicks(
      rules,
      { prices: { SOL: 90, BTC: 60_000 }, confirmedTx: [], seenOrigins: [] },
      2000,
    );
    expect(quiet).toHaveLength(0);

    // missing asset in tick -> no fire, no throw
    expect(
      evaluateTicks([rules[0]!], { prices: {}, confirmedTx: [], seenOrigins: [] }, 3000),
    ).toHaveLength(0);
  });

  it("fires txConfirmed and newOrigin rules", () => {
    const rules: AlertRule[] = [
      { kind: "txConfirmed", id: "tx1", hashedAddrHex: HASH, txHash: "0xdeadbeef" },
      { kind: "newOrigin", id: "sec1", origin: "https://evil.example" },
    ];
    const fired = evaluateTicks(
      rules,
      { prices: {}, confirmedTx: ["0xdeadbeef"], seenOrigins: ["https://evil.example"] },
      5000,
    );
    expect(fired).toHaveLength(2);
    expect(fired[0]!.title).toMatch(/confirmed/i);
    expect(fired[1]!.title).toMatch(/connection/i);
    // txConfirmed rule rejects raw addresses at construction
    expect(() =>
      evaluateTicks(
        [{ kind: "txConfirmed", id: "bad", hashedAddrHex: "0x1234", txHash: "0x1" }],
        { prices: {}, confirmedTx: [], seenOrigins: [] },
      ),
    ).toThrow();
  });

  it("subscribe payload requires sha256 hex, rejects raw addresses", () => {
    const p = buildSubscribePayload(HASH, "push-token-123");
    expect(p.hashedAddrHex).toBe(HASH);
    expect(() => buildSubscribePayload("0x1111111111111111111111111111111111111111", "push-token-123")).toThrow();
    expect(() => buildSubscribePayload("not-hex", "push-token-123")).toThrow();
    expect(() => buildSubscribePayload(HASH, "short")).toThrow();
    // gateway parity: only lowercase sha256 hex is accepted
    expect(() => buildSubscribePayload(HASH.toUpperCase(), "push-token-123")).toThrow();
  });

  it("queue caps size and dedupes by id", () => {
    const q = new NotificationQueue();
    const n = { id: "n1", ruleId: "r1", title: "Hi", body: "hello", at: 1 };
    expect(q.push(n)).toBe(true);
    expect(q.push(n)).toBe(false); // dupe
    expect(q.size).toBe(1);
    for (let i = 0; i < 150; i++) {
      q.push({ id: `n${i + 2}`, ruleId: "r1", title: "t", body: "b", at: i });
    }
    expect(q.size).toBeLessThanOrEqual(100);
    q.clear();
    expect(q.size).toBe(0);
    expect(q.list()).toEqual([]);
    // after eviction, an evicted id may be re-added (no unbounded growth)
    expect(q.push(n)).toBe(true);
  });
});

describe("revoke list + security events (iteration 3)", () => {
  it("RevokeList revoke/isRevoked/unrevoke + export/import", () => {
    const rl = new RevokeList();
    rl.revoke("https://dapp.example", 1000, "suspicious request");
    expect(rl.isRevoked("https://dapp.example")).toBe(true);
    expect(rl.isRevoked("https://other.example")).toBe(false);
    expect(rl.isRevoked("not a url")).toBe(false);
    const json = rl.exportJSON();
    const rl2 = new RevokeList();
    rl2.importJSON(json);
    expect(rl2.list()[0]).toMatchObject({ origin: "https://dapp.example", revokedAt: 1000, reason: "suspicious request" });
    expect(rl2.unrevoke("https://dapp.example")).toBe(true);
    expect(rl2.isRevoked("https://dapp.example")).toBe(false);
  });

  it("securityEvent builds a bounded notification", () => {
    const n = securityEvent({ title: "Phishing blocked", body: "evil.example tried to sign", origin: "https://evil.example", at: 5 });
    expect(n).toMatchObject({ ruleId: "security", title: "Phishing blocked", at: 5 });
    expect(n.id.startsWith("sec:5:")).toBe(true);
  });

  it("buildRevokePayload accepts only sha256 hex", () => {
    expect(buildRevokePayload(HASH)).toEqual({ hashedAddrHex: HASH });
    expect(() => buildRevokePayload("0xabc123")).toThrow();
    expect(() => buildRevokePayload("ab".repeat(31))).toThrow();
  });
});
