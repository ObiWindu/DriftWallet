// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  checkSendAmount,
  detectNameKind,
  poisonWarning,
  resolveRecipient,
  type SendDeps,
} from "./send-flow.js";

const EVM = "eip155:1";
const ADDR_A = "0x1111111111111111111111111111111111111111";
const ADDR_B = "0x1111222222222222222222222222222222222222"; // same first4 as A, different last4
const ADDR_C = "0x9999111111111111111111111111111111111111"; // first4=9999 last4=1111
const ADDR_POISON = "0x9999" + "a".repeat(32) + "1111"; // same affixes, different address

function deps(overrides?: Partial<SendDeps>): SendDeps {
  return {
    resolveName: async (name, kind) => {
      if (kind === "ens" && name === "vitalik.eth") return ADDR_A;
      if (kind === "sns" && name === "nobody.sol") return null;
      if (kind === "sns" && name === "drift.sol") return "So11111111111111111111111111111111111111112";
      return null;
    },
    validateAddress: (chainId, addr) =>
      (chainId.startsWith("eip155:") && /^0x[0-9a-fA-F]{40}$/.test(addr)) ||
      (chainId.startsWith("solana:") && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)),
    knownHistory: [ADDR_A, ADDR_B],
    ...overrides,
  };
}

describe("send-flow — name detection", () => {
  it("detects ens/sns/ada-handle, else null", () => {
    expect(detectNameKind("vitalik.eth")).toBe("ens");
    expect(detectNameKind("a.b.eth")).toBe("ens");
    expect(detectNameKind("drift.sol")).toBe("sns");
    expect(detectNameKind("$ada")).toBe("ada-handle");
    expect(detectNameKind(ADDR_A)).toBeNull();
    expect(detectNameKind("0x1234")).toBeNull();
  });
});

describe("send-flow — poison warnings", () => {
  it("warns on first4/last4 collision with unseen address", () => {
    expect(poisonWarning([ADDR_C], ADDR_POISON)).toMatch(/mimics a known address/);
    expect(poisonWarning([ADDR_A], ADDR_A)).toBeNull(); // seen is fine
    expect(poisonWarning([ADDR_A], ADDR_B)).toMatch(/unseen address/);
    expect(poisonWarning([], ADDR_A)).toBeNull(); // no history -> no warning
  });
});

describe("send-flow — resolveRecipient pipeline", () => {
  it("resolves ENS to an address with a confirm warning", async () => {
    const r = await resolveRecipient(EVM, "vitalik.eth", deps());
    expect(r).toMatchObject({ ok: true, address: ADDR_A, source: "ens", resolvedName: "vitalik.eth" });
    if (r.ok) expect(r.warnings.some((w) => w.includes("confirm the address"))).toBe(true);
  });

  it("fails closed on unresolvable names", async () => {
    const r = await resolveRecipient(EVM, "nobody.eth", deps());
    expect(r).toMatchObject({ ok: false, code: "unresolved-name" });
  });

  it("validates raw addresses and applies poison warning", async () => {
    const r = await resolveRecipient(EVM, ADDR_POISON, deps({ knownHistory: [ADDR_C] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.some((w) => w.includes("mimics"))).toBe(true);
    const bad = await resolveRecipient(EVM, "0xnotanaddress", deps());
    expect(bad).toMatchObject({ ok: false, code: "invalid-address" });
  });

  it("resolves SNS on solana chains", async () => {
    const r = await resolveRecipient("solana:mainnet", "drift.sol", deps());
    expect(r).toMatchObject({ ok: true, source: "sns", address: "So11111111111111111111111111111111111111112" });
    const wrongChain = await resolveRecipient(EVM, "drift.sol", deps());
    expect(wrongChain).toMatchObject({ ok: false, code: "invalid-address" });
  });
});

describe("send-flow — amount guard", () => {
  it("enforces bigint positive <= balance", () => {
    expect(checkSendAmount("100", "1000")).toEqual({ ok: true, amount: 100n });
    expect(checkSendAmount("1001", "1000")).toMatchObject({ ok: false });
    expect(checkSendAmount("0", "1000")).toMatchObject({ ok: false });
    expect(checkSendAmount("1.5", "1000")).toMatchObject({ ok: false });
    expect(checkSendAmount("-5", "1000")).toMatchObject({ ok: false });
  });
});
