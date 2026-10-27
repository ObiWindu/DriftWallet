// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { buildCardanoHardwareIntent } from "./cardano.js";

const BODY = "0x" + "aa".repeat(64);

describe("cardano hardware intent", () => {
  it("builds intent with witness paths + hardware flag", () => {
    const { intent, display } = buildCardanoHardwareIntent({
      txBodyCborHex: BODY,
      witnessPaths: ["m/1852'/1815'/0'/0/0"],
      feeLovelace: "200000",
    });
    expect(intent.hardware).toBe(true);
    expect(intent.witnessPaths).toHaveLength(1);
    expect(display.decodedCall).toContain("Cardano");
  });

  it("mentions witness count in warnings", () => {
    const { display } = buildCardanoHardwareIntent({
      txBodyCborHex: BODY,
      witnessPaths: ["m/1852'/1815'/0'/0/0", "m/1852'/1815'/0'/0/1"],
    });
    expect(display.warnings.some((w) => w.includes("2 witness"))).toBe(true);
  });

  it("rejects non-CIP-1852 witness path", () => {
    expect(() =>
      buildCardanoHardwareIntent({ txBodyCborHex: BODY, witnessPaths: ["m/44'/60'/0'/0/0"] }),
    ).toThrow(/CIP-1852/);
  });

  it("rejects empty witness list", () => {
    expect(() => buildCardanoHardwareIntent({ txBodyCborHex: BODY, witnessPaths: [] })).toThrow();
  });
});
