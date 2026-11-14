// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { Keystore, MemoryVaultStorage } from "./index.js";
import type { EncryptedVault, SessionId, SignerIface } from "./index.js";

// Mock signer: mimics Rust contract (wrong password fails, lock wipes session).
function mockSigner(): SignerIface & { _sessions: Map<number, string> } {
  const sessions = new Map<number, string>();
  let next = 1;
  const vaults = new Map<string, { phrase: string; password: string }>();
  const api: SignerIface & { _sessions: Map<number, string> } = {
    _sessions: sessions,
    async generateMnemonic() {
      return "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    },
    async validateMnemonic(p: string) {
      return p.trim().split(/\s+/).length >= 12;
    },
    async entropyToVault(phrase: string, password: string) {
      const v: EncryptedVault = {
        version: 1,
        saltHex: "00".repeat(32),
        nonceHex: "00".repeat(24),
        ciphertextHex: Buffer.from(`${phrase}::${password}`).toString("hex"),
        argon2: { mKib: 8192, tCost: 1, pCost: 1 },
      };
      vaults.set(v.ciphertextHex, { phrase, password });
      return v;
    },
    async unlockVault(vault: EncryptedVault, password: string) {
      const rec = vaults.get(vault.ciphertextHex);
      if (!rec || rec.password !== password) throw new Error("wrong password");
      const id = next++ as SessionId;
      sessions.set(id, rec.phrase);
      return id;
    },
    async lock(s: SessionId) {
      if (!sessions.has(s)) throw new Error("bad session");
      sessions.delete(s);
    },
    async derivePubkey() {
      return { publicKeyHex: "02" + "ab".repeat(32), address: "0xmock" };
    },
    async signEvm() { return { rawTxHex: "0x02mock", txHashHex: "0xmock" }; },
    async signSolana() { return { signatureBase58: "sig", publicKeyBase58: "pk" }; },
    async signBitcoin() { return { signatures: [] }; },
    async signCardano() { return { witnesses: [], txBodyHashHex: "00".repeat(32) }; },
  };
  return api;
}

describe("keystore (no plaintext outside signer)", () => {
  it("create -> unlock -> lock; wrong password fails", async () => {
    const signer = mockSigner();
    const ks = new Keystore(signer, new MemoryVaultStorage(), { autoLockMs: 50 });
    const { vaultRef } = await ks.createWallet("correct-horse-8!");
    const { sessionId } = await ks.unlock(vaultRef, "correct-horse-8!");
    expect(signer._sessions.has(sessionId)).toBe(true);
    await expect(ks.unlock(vaultRef, "wrong")).rejects.toThrow();
    await ks.lock(sessionId);
    expect(signer._sessions.has(sessionId)).toBe(false);
  });
  it("auto-lock fires", async () => {
    const onLock = vi.fn();
    const signer = mockSigner();
    const ks = new Keystore(signer, new MemoryVaultStorage(), { autoLockMs: 20, events: { onLock } });
    const { vaultRef } = await ks.createWallet("correct-horse-8!");
    await ks.unlock(vaultRef, "correct-horse-8!");
    await new Promise((r) => setTimeout(r, 60));
    expect(onLock).toHaveBeenCalled();
  });
});

describe("keystore iteration 3 — duress, spend limits, wipe", () => {
  it("duress PIN unlocks the decoy vault and fires onDuressUnlock", async () => {
    const onDuress = vi.fn();
    const signer = mockSigner();
    const storage = new MemoryVaultStorage();
    const ks = new Keystore(signer, storage, { events: { onDuressUnlock: onDuress } });
    const { vaultRef } = await ks.createWallet("main-password-1");
    expect(await ks.hasDuress(vaultRef)).toBe(false);
    await ks.setupDuress(vaultRef, "main-password-1", "duress-pin-99");
    expect(await ks.hasDuress(vaultRef)).toBe(true);
    // wrong main-password setup must fail
    await expect(ks.setupDuress(vaultRef, "nope-nope-nope", "duress-pin-99")).rejects.toThrow();

    const main = await ks.unlock(vaultRef, "main-password-1");
    expect(main.duress).toBe(false);
    const duress = await ks.unlock(vaultRef, "duress-pin-99");
    expect(duress.duress).toBe(true);
    expect(duress.sessionId).not.toBe(main.sessionId);
    expect(onDuress).toHaveBeenCalledWith(duress.sessionId);
    await expect(ks.unlock(vaultRef, "neither-12345")).rejects.toThrow(/invalid password/);
    await ks.lockAll();
  });

  it("spending limits: record until cap, then throw SPEND_LIMIT_EXCEEDED", async () => {
    const signer = mockSigner();
    const ks = new Keystore(signer, new MemoryVaultStorage());
    const { vaultRef } = await ks.createWallet("correct-horse-8!");
    const { sessionId } = await ks.unlock(vaultRef, "correct-horse-8!");
    expect(ks.getSpend(sessionId)).toEqual({ spentBaseUnits: 0n, limitBaseUnits: null, remainingBaseUnits: null });
    ks.setSpendLimit(sessionId, 1000n);
    expect(ks.recordSpend(sessionId, "400").remainingBaseUnits).toBe(600n);
    expect(ks.recordSpend(sessionId, "600").spentBaseUnits).toBe(1000n);
    expect(() => ks.recordSpend(sessionId, "1")).toThrow(/SPEND_LIMIT_EXCEEDED/);
    ks.setSpendLimit(sessionId, null); // unlimited
    expect(ks.recordSpend(sessionId, "999999").remainingBaseUnits).toBeNull();
    expect(() => ks.setSpendLimit(9999, 1n)).toThrow(/unknown session/);
    await ks.lock(sessionId);
    expect(() => ks.getSpend(sessionId)).toThrow(/unknown session/);
  });

  it("wipeAll removes vaults + duress and locks sessions", async () => {
    const signer = mockSigner();
    const storage = new MemoryVaultStorage();
    const ks = new Keystore(signer, storage);
    const { vaultRef } = await ks.createWallet("correct-horse-8!");
    await ks.setupDuress(vaultRef, "correct-horse-8!", "duress-pin-99");
    const { sessionId } = await ks.unlock(vaultRef, "correct-horse-8!");
    expect(signer._sessions.has(sessionId)).toBe(true);
    await ks.wipeAll();
    expect(signer._sessions.has(sessionId)).toBe(false);
    expect(await storage.load(vaultRef.vaultId)).toBeNull();
    expect(await storage.load(`${vaultRef.vaultId}.duress`)).toBeNull();
    await expect(ks.unlock(vaultRef, "correct-horse-8!")).rejects.toThrow(/vault not found/);
  });
});
