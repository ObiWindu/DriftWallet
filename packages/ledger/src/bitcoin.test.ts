// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { buildBitcoinHardwareIntent } from "./bitcoin.js";

// Minimal PSBT magic bytes: "psbt\xff" + padding, base64-encoded.
const PSBT = Buffer.from("psbt\xff" + "\x00".repeat(16), "binary").toString("base64");

describe("bitcoin hardware intent", () => {
  it("builds PSBT intent with fee fields + hardware flag", () => {
    const { intent, display } = buildBitcoinHardwareIntent({ psbtBase64: PSBT, feeSats: "500" });
    expect(intent.hardware).toBe(true);
    expect(intent.feeSats).toBe("500");
    expect(display.decodedCall).toContain("PSBT");
  });

  it("warns on very high fee rate", () => {
    const { display } = buildBitcoinHardwareIntent({ psbtBase64: PSBT, feeSats: "100", feeRateSatVb: "1000" });
    expect(display.warnings.some((w) => w.includes("Fee rate"))).toBe(true);
  });

  it("rejects non-PSBT payload", () => {
    const bad = Buffer.from("not-a-psbt-payload!!", "utf8").toString("base64");
    expect(() => buildBitcoinHardwareIntent({ psbtBase64: bad, feeSats: "100" })).toThrow(/PSBT/);
  });

  it("rejects bad fee rate", () => {
    expect(() => buildBitcoinHardwareIntent({ psbtBase64: PSBT, feeSats: "100", feeRateSatVb: "0" })).toThrow(
      /bad fee rate/,
    );
  });
});
