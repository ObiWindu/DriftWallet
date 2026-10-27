// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { approve, pendingApprovals, reject, requestApproval, verdictDisplay } from "./approval.js";

const base = {
  origin: "https://app.example",
  method: "eth_sendTransaction",
  paramsSummary: "send 0.1 ETH",
  verdict: "allow" as const,
  verdictReason: "within policy",
  receivedAt: 1700000000000,
};

describe("approval queue", () => {
  it("queues then approves", () => {
    let q: Parameters<typeof approve>[0] = [];
    q = requestApproval(q, { ...base, id: "a1" });
    expect(pendingApprovals(q)).toHaveLength(1);
    q = approve(q, "a1");
    expect(pendingApprovals(q)).toHaveLength(0);
    expect(q[0]?.decision).toBe("approved");
  });

  it("queues then rejects, blocks double-decide", () => {
    let q: Parameters<typeof reject>[0] = [];
    q = requestApproval(q, { ...base, id: "b1", verdict: "deny", verdictReason: "blocked" });
    q = reject(q, "b1");
    expect(q[0]?.decision).toBe("rejected");
    expect(() => approve(q, "b1")).toThrow();
    expect(() => approve(q, "nope")).toThrow();
    expect(() => requestApproval(q, { ...base, id: "b1" })).toThrow();
  });

  it("renders verdict display model", () => {
    expect(verdictDisplay("allow").tone).toBe("ok");
    expect(verdictDisplay("deny").tone).toBe("bad");
    expect(verdictDisplay("stepUp").tone).toBe("warn");
  });
});
