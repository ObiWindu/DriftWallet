// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { policyBannerProps, sendGate, validateSendForm } from "./send.js";

const BASE = {
  chain: "ethereum",
  to: "0x" + "ab".repeat(20),
  decimals: 18,
  balanceBaseUnits: 10_000_000_000_000_000_000n, // 10 ETH
  medianFeeBaseUnits: 1_000_000_000_000_000n, // 0.001 ETH
  priceCents: 200_000n, // $2000
} as const;

describe("send screen VM", () => {
  it("validates the happy path with bigint-exact math", () => {
    const r = validateSendForm({ ...BASE, amountText: "1.5", feeLevel: "med" });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.send.amountBaseUnits).toBe(1_500_000_000_000_000_000n);
    expect(r.send.feeBaseUnits).toBe(1_000_000_000_000_000n);
    expect(r.send.totalBaseUnits).toBe(1_501_000_000_000_000_000n);
    expect(r.send.amountFiat).toBe("$3000.00");
    expect(r.send.feeFiat).toBe("$2.00");
    expect(r.send.biometricRequired).toBe(true);
  });

  it("rejects bad addresses, amounts, and insufficient balances", () => {
    expect(validateSendForm({ ...BASE, amountText: "1", to: "0x123" })).toEqual({
      ok: false,
      errorKey: "send.invalidAddress",
    });
    expect(validateSendForm({ ...BASE, amountText: "abc" })).toEqual({
      ok: false,
      errorKey: "send.invalidAmount",
    });
    expect(validateSendForm({ ...BASE, amountText: "0" })).toEqual({
      ok: false,
      errorKey: "send.invalidAmount",
    });
    // 10 ETH doesn't cover 10 ETH + fee.
    expect(validateSendForm({ ...BASE, amountText: "10" })).toEqual({
      ok: false,
      errorKey: "send.insufficient",
    });
  });

  it("applies fee tiers with ceiling and gates biometrics at $100", () => {
    const low = validateSendForm({ ...BASE, amountText: "0.05", feeLevel: "low" });
    expect(low.ok && low.send.feeBaseUnits).toBe(800_000_000_000_000n);
    // 0.05 ETH @ $2000 = exactly $100.00 -> NOT over threshold.
    expect(low.ok && low.send.biometricRequired).toBe(false);
    expect(low.ok && low.send.amountFiat).toBe("$100.00");
    // 0.050005 ETH @ $2000 = $100.01 -> over threshold (cents truncate down,
    // so the boundary needs a full cent over $100.00).
    const over = validateSendForm({ ...BASE, amountText: "0.050005" });
    expect(over.ok && over.send.biometricRequired).toBe(true);
    // 1 wei amount with 1 wei median fee: fee ceils, never zero.
    const dust = validateSendForm({
      ...BASE,
      amountText: "0.000000000000000001",
      medianFeeBaseUnits: 1n,
      feeLevel: "low",
    });
    expect(dust.ok && dust.send.feeBaseUnits).toBe(1n);
  });

  it("gates sends on biometrics in integer cents", () => {
    expect(sendGate({ amountFiatCents: 10_000n, biometricOk: false }).allowed).toBe(true);
    expect(sendGate({ amountFiatCents: 10_001n, biometricOk: false })).toEqual({
      allowed: false,
      biometricRequired: true,
      reasonKey: "send.biometricRequired",
    });
    expect(sendGate({ amountFiatCents: 10_001n, biometricOk: true }).allowed).toBe(true);
    expect(() => sendGate({ amountFiatCents: -1n, biometricOk: true })).toThrow();
  });

  it("maps policy verdicts to banner props", () => {
    expect(policyBannerProps({ verdict: "allow", findings: [] })).toEqual({
      tone: "allow",
      titleKey: "policy.allow",
      findingCount: 0,
    });
    expect(
      policyBannerProps({
        verdict: "block",
        findings: [{ code: "PHISH_DOMAIN", message: "blocked" }],
      }).titleKey,
    ).toBe("policy.block");
    expect(() => policyBannerProps({ verdict: "maybe" as "allow", findings: [] })).toThrow();
  });
});
