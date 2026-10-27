// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { createWalletStore } from "./store.js";

describe("wallet store (zustand, no key material)", () => {
  it("starts locked, unlock/lock cycle holds opaque id only", () => {
    const s = createWalletStore();
    expect(s.getState().lock).toEqual({ status: "locked" });
    s.getState().unlock(42);
    expect(s.getState().lock).toEqual({ status: "unlocked", sessionId: 42 });
    s.getState().lockWallet();
    expect(s.getState().lock.status).toBe("locked");
  });
  it("rejects bad session ids and chains", () => {
    const s = createWalletStore();
    expect(() => s.getState().unlock(0)).toThrow();
    expect(() => s.getState().selectChain("eip155:999999")).toThrow();
    s.getState().selectChain("solana:mainnet");
    expect(s.getState().selectedChain).toBe("solana:mainnet");
  });
  it("bounds auto-lock 30s–30min", () => {
    const s = createWalletStore();
    expect(() => s.getState().setAutoLockMs(1000)).toThrow();
    s.getState().setAutoLockMs(60_000);
    expect(s.getState().autoLockMs).toBe(60_000);
  });
});
