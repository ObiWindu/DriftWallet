// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { approvalFromPolicy, decideWithPolicy, typedDataDomainOf, approveWithGate, MemoryWebAuthnGate, requestApproval, type ApprovalEntry } from "./approval.js";
import type { Intent } from "@drift/policy-engine";

const baseIntent: Intent = {
  chainId: "eip155:1",
  kind: "native-transfer",
  from: "0x1",
  to: "0x2",
  amountBaseUnits: "1000",
  feeBaseUnits: "10",
  origin: "https://app.uniswap.org",
};

describe("decideWithPolicy — sim mismatch blocks, warn steps up (F-P0-3)", () => {
  it("allow maps to allow", async () => {
    const d = await decideWithPolicy({ intent: baseIntent });
    expect(d.verdict).toBe("allow");
    expect(approvalFromPolicy(d).verdict).toBe("allow");
  });

  it("phishing origin maps to deny", async () => {
    const d = await decideWithPolicy({ intent: { ...baseIntent, origin: "https://evil-drain.example" } });
    expect(d.verdict).toBe("deny");
    expect(d.findings.some((f) => f.code === "PHISH_DOMAIN")).toBe(true);
  });

  it("dynamic phish list blocks", async () => {
    const d = await decideWithPolicy({ intent: baseIntent, ctx: { phishDomains: ["app.uniswap.org"] } });
    expect(d.verdict).toBe("deny");
  });

  it("simulation mismatch -> deny; match -> allow with SIM_OK", async () => {
    const claimed = [{ address: "0x1", token: "native", before: "1010", after: "0", delta: "-1010" }];
    const ok = await decideWithPolicy({ intent: baseIntent, ctx: { claimed, simulated: claimed } });
    expect(ok.verdict).toBe("allow");
    const bad = await decideWithPolicy({
      intent: baseIntent,
      ctx: { claimed, simulated: [{ ...claimed[0], after: "5", delta: "-1005" } as never] },
    });
    expect(bad.verdict).toBe("deny");
    expect(bad.reason).toMatch(/simulation/i);
  });

  it("spending limit exceeded -> deny", async () => {
    const d = await decideWithPolicy({ intent: baseIntent, ctx: { spentBaseUnits: "999", spendLimitBaseUnits: "1000" } });
    expect(d.verdict).toBe("deny");
    expect(d.findings.some((f) => f.code === "SPEND_LIMIT_EXCEEDED")).toBe(true);
  });

  it("high fee warn -> stepUp", async () => {
    const d = await decideWithPolicy({
      intent: { ...baseIntent, amountBaseUnits: "1000", feeBaseUnits: "100" }, // 10% fee
    });
    expect(d.verdict).toBe("stepUp");
  });

  it("deny verdict can never be approved even with gate", async () => {
    let queue: ApprovalEntry[] = requestApproval([], {
      id: "a1", origin: "https://evil-drain.example", method: "eth_sendTransaction",
      paramsSummary: "send", verdict: "deny", verdictReason: "phish", receivedAt: 1,
    });
    const d = await decideWithPolicy({ intent: { ...baseIntent, origin: "https://evil-drain.example" } });
    const entry = queue[0]!;
    const patched = [{ ...entry, verdict: d.verdict, verdictReason: d.reason }];
    await expect(approveWithGate(patched, "a1", new MemoryWebAuthnGate())).rejects.toThrow(/policy deny/);
  });

  it("stepUp verdict requires the WebAuthn gate", async () => {
    const queue: ApprovalEntry[] = requestApproval([], {
      id: "a2", origin: "https://app.uniswap.org", method: "eth_sendTransaction",
      paramsSummary: "send", verdict: "stepUp", verdictReason: "high fee", receivedAt: 1,
    });
    const ok = await approveWithGate(queue, "a2", new MemoryWebAuthnGate({ approveAll: true }));
    expect(ok.credentialId).toBe("memory-stub-credential");
    expect(ok.queue[0]?.decision).toBe("approved");
    await expect(approveWithGate(queue, "a2", new MemoryWebAuthnGate({ available: false }))).rejects.toThrow(/unavailable/);
  });
});

describe("typedDataDomainOf", () => {
  it("extracts domain from EIP-712 params array", () => {
    const d = typedDataDomainOf(["0x1", { domain: { name: "Uniswap", chainId: 1, verifyingContract: "0xabc" }, message: {} }]);
    expect(d).toMatchObject({ name: "Uniswap", chainId: 1, verifyingContract: "0xabc" });
    expect(typedDataDomainOf(["0x1", { message: {} }])).toBeUndefined();
    expect(typedDataDomainOf("garbage")).toBeUndefined();
  });
});
