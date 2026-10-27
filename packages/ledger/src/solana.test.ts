// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { buildSolanaHardwareIntent } from "./solana.js";

describe("solana hardware intent", () => {
  it("builds intent with path + hardware flag", () => {
    const { intent, display } = buildSolanaHardwareIntent({ messageBytesHex: "0x01020304" });
    expect(intent.hardware).toBe(true);
    expect(intent.path).toBe("m/44'/501'/0'/0'");
    expect(display.decodedCall).toContain("Solana transaction");
  });

  it("warns on unusually high fee", () => {
    const { display } = buildSolanaHardwareIntent({ messageBytesHex: "0x0102", feeLamports: "500000" });
    expect(display.warnings.some((w) => w.toLowerCase().includes("fee"))).toBe(true);
  });

  it("rejects empty message", () => {
    expect(() => buildSolanaHardwareIntent({ messageBytesHex: "0x" })).toThrow();
  });

  it("rejects oversized message", () => {
    expect(() => buildSolanaHardwareIntent({ messageBytesHex: `0x${"ff".repeat(2000)}` })).toThrow(
      /too large/,
    );
  });
});
