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
