// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from "vitest";
import {
  handleOffscreenMessage,
  hasSession,
  lockSession,
  setSessionForTests,
  type SignerIface,
} from "./offscreen.js";

function mockSigner(): SignerIface & { unlocked: boolean; locked: boolean } {
  const state = { unlocked: false, locked: false };
  return {
    get unlocked() {
      return state.unlocked;
    },
    get locked() {
      return state.locked;
    },
    async unlockVault(payload) {
      if (payload.password !== "pw") throw new Error("signer unlock_vault: wrong password");
      state.unlocked = true;
      return { sessionId: 7 };
    },
    async lockSession() {
      state.locked = true;
    },
    async signEth() {
      return "0x02deadbeef";
    },
    async signSolana() {
      return "5xSigBase58";
    },
    async signCardano() {
      return JSON.stringify({ witnesses: [] });
    },
    async signBtc() {
      return JSON.stringify([]);
    },
  };
}

const ethPayload = {
  chainId: 1,
  to: "0x0000000000000000000000000000000000000001",
  valueWei: "1000",
  nonce: 0,
  gasLimit: "21000",
  maxFeePerGasWei: "1000000000",
  maxPriorityFeePerGasWei: "1000000000",
  dataHex: "0x",
  path: "m/44'/60'/0'/0/0",
};

describe("handleOffscreenMessage", () => {
  beforeEach(() => {
    setSessionForTests(null);
  });

  it("rejects signing while locked", async () => {
    const r = await handleOffscreenMessage(
      { channel: "drift-v1", kind: "signEth", requestId: "r1", payload: ethPayload },
      mockSigner(),
    );
    expect(r).toEqual({ requestId: "r1", ok: false, error: "locked" });
  });

  it("unlocks, signs, and locks end-to-end", async () => {
    const signer = mockSigner();
    const bad = await handleOffscreenMessage(
      { channel: "drift-v1", kind: "unlock", requestId: "r1", payload: { vault: { version: 1 }, password: "nope" } },
      signer,
    );
    expect(bad.ok).toBe(false);
    expect(hasSession()).toBe(false);

    const un = await handleOffscreenMessage(
      { channel: "drift-v1", kind: "unlock", requestId: "r2", payload: { vault: { version: 1 }, password: "pw" } },
      signer,
    );
    expect(un).toEqual({ requestId: "r2", ok: true });
    expect(hasSession()).toBe(true);

    const sig = await handleOffscreenMessage(
      { channel: "drift-v1", kind: "signEth", requestId: "r3", payload: ethPayload },
      signer,
    );
    expect(sig).toEqual({ requestId: "r3", ok: true, signature: "0x02deadbeef" });

    const lock = await handleOffscreenMessage(
      { channel: "drift-v1", kind: "lock", requestId: "r4", payload: null },
      signer,
    );
    expect(lock).toEqual({ requestId: "r4", ok: true });
    expect(hasSession()).toBe(false);
    expect(signer.locked).toBe(true);
  });

  it("rejects malformed sign payloads at the boundary", async () => {
    const signer = mockSigner();
    setSessionForTests({ sessionId: 7 });
    const r = await handleOffscreenMessage(
      { channel: "drift-v1", kind: "signEth", requestId: "r9", payload: { chainId: "not-a-number" } },
      signer,
    );
    expect(r.ok).toBe(false);
    expect(r.requestId).toBe("r9");
  });

  it("rejects bad envelopes", async () => {
    await expect(
      handleOffscreenMessage({ channel: "other", kind: "lock", requestId: "x" }, mockSigner()),
    ).rejects.toThrow();
    lockSession();
  });
});
