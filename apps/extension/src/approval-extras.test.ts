// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// U021 tests: decoded-call producers, calldata decoding, sim-diff display,
// per-origin settings, WebAuthn-gated approve. Existing approval.test.ts
// (queue API) must keep passing untouched.
import { describe, expect, it } from "vitest";
import {
  approveWithGate,
  decodedApprove,
  decodedStake,
  decodedTransfer,
  decodeEvmCalldata,
  getOriginPolicy,
  MemoryWebAuthnGate,
  requestApproval,
  setOriginPolicy,
  shouldAutoReject,
  simDiffDisplay,
  simMatchesClaimed,
  type ApprovalEntry,
} from "./approval.js";

const base = {
  origin: "https://app.example",
  method: "eth_sendTransaction",
  paramsSummary: "send 0.1 ETH",
  verdict: "allow" as const,
  verdictReason: "within policy",
  receivedAt: 1700000000000,
};

function queueWith(id: string, verdict: "allow" | "deny" | "stepUp"): ApprovalEntry[] {
  return requestApproval([], { ...base, id, verdict });
}

describe("decoded-call producers", () => {
  it("transfer producer", () => {
    const d = decodedTransfer("ETH", "0xabc", "1000000000000000000", 18);
    expect(d.kind).toBe("transfer");
    if (d.kind === "transfer") {
      expect(d.to).toBe("0xabc");
      expect(d.amountMinor).toBe("1000000000000000000");
    }
  });

  it("approve flags infinite allowance", () => {
    const max = ((1n << 256n) - 1n).toString();
    const inf = decodedApprove("USDC", "0xspender", max, 6);
    expect(inf.kind).toBe("approve");
    if (inf.kind === "approve") expect(inf.unlimited).toBe(true);
    const exact = decodedApprove("USDC", "0xspender", "1000000", 6);
    if (exact.kind === "approve") expect(exact.unlimited).toBe(false);
  });

  it("stake producer", () => {
    const s = decodedStake("pool-1", "5000000000", 9, "delegate");
    expect(s).toMatchObject({ kind: "stake", action: "delegate" });
  });
});

describe("decodeEvmCalldata", () => {
  const to = "0x1111111111111111111111111111111111111111";
  const word = (addr: string) => addr.slice(2).toLowerCase().padStart(64, "0");
  const amt = (n: bigint) => n.toString(16).padStart(64, "0");

  it("decodes ERC-20 transfer", () => {
    const dataHex = `0xa9059cbb${word(to)}${amt(1000000n)}`;
    const d = decodeEvmCalldata({ dataHex, decimals: 6 }, "USDC");
    expect(d.kind).toBe("transfer");
    if (d.kind === "transfer") {
      expect(d.to.toLowerCase()).toBe(to);
      expect(d.amountMinor).toBe("1000000");
    }
  });

  it("decodes ERC-20 approve + unlimited flag", () => {
    const dataHex = `0x095ea7b3${word(to)}${"f".repeat(64)}`;
    const d = decodeEvmCalldata({ dataHex }, "USDC");
    expect(d.kind).toBe("approve");
    if (d.kind === "approve") expect(d.unlimited).toBe(true);
  });

  it("unknown selector never throws", () => {
    const d = decodeEvmCalldata({ dataHex: "0xdeadbeef" });
    expect(d.kind).toBe("unknown");
    expect(decodeEvmCalldata({ nope: 1 }).kind).toBe("unknown");
    expect(decodeEvmCalldata("0x1234").kind).toBe("unknown");
  });
});

describe("simulation-diff display", () => {
  const fmt = (minor: string) => `${minor} units`;
  const diffs = [
    { address: "0xaaa", token: "ETH", before: "100", after: "90", delta: "-10" },
    { address: "0xbbb", token: "USDC", before: "0", after: "50", delta: "50" },
    { address: "0xccc", token: "ETH", before: "5", after: "5", delta: "0" },
  ];

  it("renders in/out/none rows", () => {
    const rows = simDiffDisplay(diffs, fmt);
    expect(rows[0]).toMatchObject({ direction: "out" });
    expect(rows[0]?.delta).toBe("-10 units");
    expect(rows[1]).toMatchObject({ direction: "in" });
    expect(rows[1]?.delta).toBe("+50 units");
    expect(rows[2]).toMatchObject({ direction: "none" });
  });

  it("matches claimed vs simulated", () => {
    expect(simMatchesClaimed(diffs, diffs)).toBe(true);
    const tampered = diffs.map((d, i) => (i === 0 ? { ...d, after: "91" } : d));
    expect(simMatchesClaimed(diffs, tampered)).toBe(false);
    expect(simMatchesClaimed(diffs, diffs.slice(0, 2))).toBe(false);
    expect(simMatchesClaimed("garbage", diffs)).toBe(false);
  });
});

describe("per-origin settings", () => {
  it("defaults to always-ask, supports auto-reject list", () => {
    const empty = {};
    expect(getOriginPolicy(empty, "https://new.example")).toBe("always-ask");
    expect(shouldAutoReject(empty, "https://new.example")).toBe(false);
    const m = setOriginPolicy(empty, "https://evil.example", "auto-reject");
    expect(shouldAutoReject(m, "https://evil.example")).toBe(true);
    expect(shouldAutoReject(m, "https://other.example")).toBe(false);
    // empty map unchanged (immutable update)
    expect(shouldAutoReject(empty, "https://evil.example")).toBe(false);
    expect(() => setOriginPolicy({}, "not-a-url", "auto-reject")).toThrow();
  });
});

describe("webauthn-gated approve", () => {
  it("approves allow verdict without gate by default", async () => {
    const q = queueWith("g1", "allow");
    const res = await approveWithGate(q, "g1", new MemoryWebAuthnGate());
    expect(res.credentialId).toBeNull();
    expect(res.queue[0]?.decision).toBe("approved");
  });

  it("stepUp verdict requires the gate", async () => {
    const q = queueWith("g2", "stepUp");
    const res = await approveWithGate(q, "g2", new MemoryWebAuthnGate());
    expect(res.credentialId).toBe("memory-stub-credential");
    // gate unavailable → throws, queue untouched
    await expect(approveWithGate(q, "g2", new MemoryWebAuthnGate({ available: false }))).rejects.toThrow(
      /unavailable/,
    );
    expect(q[0]?.decision).toBe("pending");
  });

  it("deny verdict can never be approved, even with requireGate", async () => {
    const q = queueWith("g3", "deny");
    await expect(approveWithGate(q, "g3", new MemoryWebAuthnGate(), { requireGate: true })).rejects.toThrow(
      /deny/,
    );
  });

  it("user cancellation rejects", async () => {
    const q = queueWith("g4", "stepUp");
    await expect(
      approveWithGate(q, "g4", new MemoryWebAuthnGate({ approveAll: false })),
    ).rejects.toThrow(/cancelled/);
  });

  it("memory gate validates input", async () => {
    const gate = new MemoryWebAuthnGate();
    expect(await gate.isAvailable()).toBe(true);
    await expect(gate.assert("")).rejects.toThrow();
  });
});
