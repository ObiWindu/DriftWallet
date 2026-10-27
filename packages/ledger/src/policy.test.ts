// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { evaluateBlindSignPolicy, requireBlindSignAllowed } from "./policy.js";

describe("blind-sign policy", () => {
  it("blocks opaque eth_sign when hash not displayed", () => {
    const d = evaluateBlindSignPolicy({
      kind: "eth_sign",
      opaque: true,
      deviceAttestation: { hashDisplayed: false },
    });
    expect(d.verdict).toBe("block");
    expect(d.code).toBe("OPAQUE_SIGN");
  });

  it("warns (not blocks) opaque payload when device confirmed hash", () => {
    const d = evaluateBlindSignPolicy({
      kind: "opaque",
      opaque: true,
      deviceAttestation: { hashDisplayed: true },
    });
    expect(d.verdict).toBe("warn");
    expect(d.warnings.length).toBeGreaterThan(0);
  });

  it("allows typed-data with hash displayed", () => {
    const d = evaluateBlindSignPolicy({
      kind: "typedData",
      opaque: false,
      deviceAttestation: { hashDisplayed: true },
    });
    expect(d.verdict).toBe("allow");
  });

  it("warns typed-data when hash not displayed", () => {
    const d = evaluateBlindSignPolicy({
      kind: "typedData",
      opaque: false,
      deviceAttestation: { hashDisplayed: false },
    });
    expect(d.verdict).toBe("warn");
  });

  it("requireBlindSignAllowed throws on block", () => {
    expect(() =>
      requireBlindSignAllowed({ kind: "eth_sign", opaque: true, deviceAttestation: { hashDisplayed: false } }),
    ).toThrow(/OPAQUE_SIGN/);
  });
});
