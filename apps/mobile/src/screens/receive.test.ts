// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { receiveState, truncateMiddle } from "./receive.js";

describe("receive screen VM", () => {
  it("shapes address into QR payload, share text, and truncation", () => {
    const addr = "0x" + "ab".repeat(20);
    const s = receiveState({ address: addr, chainId: "eip155:1" });
    expect(s.qrPayload).toBe(addr);
    expect(s.shareText).toBe(addr);
    expect(s.truncated).toBe("0xabab…abab");
    expect(s.titleKey).toBe("receive.title");
    expect(s.copyKey).toBe("receive.copyAddress");
    expect(s.shareKey).toBe("receive.share");
  });

  it("always requires FLAG_SECURE on the receive screen", () => {
    const s = receiveState({ address: "11111111111111111111111111111111", chainId: "solana:mainnet" });
    expect(s.flagSecure).toBe(true);
  });

  it("truncates only long addresses", () => {
    expect(truncateMiddle("abc")).toBe("abc");
    expect(truncateMiddle("0x" + "ab".repeat(20), 6)).toBe("0xababab…ababab");
  });

  it("rejects empty or oversized input", () => {
    expect(() => receiveState({ address: "", chainId: "eip155:1" })).toThrow();
    expect(() => receiveState({ address: "x".repeat(257), chainId: "eip155:1" })).toThrow();
    expect(() => receiveState({ address: "0xabc", chainId: "" })).toThrow();
  });
});
