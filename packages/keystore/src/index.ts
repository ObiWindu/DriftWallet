// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

// Local copies of signer-ts contracts (decoupled for audit boundary;
// MUST stay in sync with packages/signer/ts/src/index.ts).
export interface EncryptedVault {
  version: 1;
  saltHex: string;
  nonceHex: string;
  ciphertextHex: string;
  argon2: { mKib: number; tCost: number; pCost: number };
}
export type SessionId = number;
export type Curve = "Secp256k1" | "Ed25519";
export interface SignerIface {
  generateMnemonic(strengthBits: 128 | 256): Promise<string>;
  validateMnemonic(phrase: string): Promise<boolean>;
  entropyToVault(phrase: string, password: string, lightKdf?: boolean): Promise<EncryptedVault>;
  unlockVault(vault: EncryptedVault, password: string): Promise<SessionId>;
  lock(sessionId: SessionId): Promise<void>;
  derivePubkey(sessionId: SessionId, path: string, curve: Curve): Promise<{ publicKeyHex: string; address: string }>;
  signEvm(sessionId: SessionId, req: unknown): Promise<{ rawTxHex: string; txHashHex: string }>;
  signSolana(sessionId: SessionId, req: unknown): Promise<{ signatureBase58: string; publicKeyBase58: string }>;
  signBitcoin(sessionId: SessionId, req: unknown): Promise<{ signatures: { publicKeyHex: string; derSigHex: string }[] }>;
  signCardano(sessionId: SessionId, req: unknown): Promise<{ witnesses: { publicKeyHex: string; signatureHex: string }[]; txBodyHashHex: string }>;
}

export const VaultRefSchema = z.object({ vaultId: z.string().min(1), version: z.literal(1), storedAt: z.number() });
export type VaultRef = z.infer<typeof VaultRefSchema>;

// In-memory ciphertext store. Production adapters (MMKV/Keychain/Keystore/chrome.storage)
// implement the same interface; plaintext NEVER leaves SignerIface session.
export interface VaultStorage {
  save(vaultId: string, vault: EncryptedVault): Promise<void>;
  load(vaultId: string): Promise<EncryptedVault | null>;
  remove(vaultId: string): Promise<void>;
}

export class MemoryVaultStorage implements VaultStorage {
  private map = new Map<string, EncryptedVault>();
  async save(id: string, v: EncryptedVault) { this.map.set(id, v); }
  async load(id: string) { return this.map.get(id) ?? null; }
  async remove(id: string) { this.map.delete(id); }
}

export interface KeystoreEvents {
  onLock?: (sessionId: SessionId) => void;
}

export class Keystore {
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  constructor(
    private signer: SignerIface,
    private storage: VaultStorage,
    private opts: { autoLockMs?: number; events?: KeystoreEvents } = {},
  ) {}

  private armAutoLock(sessionId: number) {
    const ms = this.opts.autoLockMs ?? 5 * 60 * 1000;
    this.clearTimer(sessionId);
    const t = setTimeout(() => {
      void this.signer.lock(sessionId).catch(() => undefined);
      this.opts.events?.onLock?.(sessionId);
      this.timers.delete(sessionId);
    }, ms);
    // Don't keep node process alive for tests
    const maybeUnref = t as unknown as { unref?: () => void };
    if (typeof maybeUnref.unref === "function") maybeUnref.unref();
    this.timers.set(sessionId, t);
  }
  private clearTimer(s: number) {
    const t = this.timers.get(s);
    if (t) clearTimeout(t);
    this.timers.delete(s);
  }

  async createWallet(password: string): Promise<{ vaultRef: VaultRef }> {
    if (password.length < 8) throw new Error("password too short (min 8)");
    const phrase = await this.signer.generateMnemonic(256);
    const vault = await this.signer.entropyToVault(phrase, password);
    const vaultId = `vault_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    await this.storage.save(vaultId, vault);
    return { vaultRef: { vaultId, version: 1, storedAt: Date.now() } };
  }

  async importWallet(phrase: string, password: string): Promise<{ vaultRef: VaultRef }> {
    if (password.length < 8) throw new Error("password too short (min 8)");
    if (!(await this.signer.validateMnemonic(phrase.trim()))) throw new Error("invalid mnemonic");
    const vault = await this.signer.entropyToVault(phrase.trim(), password);
    const vaultId = `vault_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    await this.storage.save(vaultId, vault);
    return { vaultRef: { vaultId, version: 1, storedAt: Date.now() } };
  }

  async unlock(vaultRef: VaultRef, password: string): Promise<{ sessionId: SessionId }> {
    const v = await this.storage.load(vaultRef.vaultId);
    if (!v) throw new Error("vault not found");
    const sessionId = await this.signer.unlockVault(v, password);
    this.armAutoLock(sessionId);
    return { sessionId };
  }

  async lock(sessionId: SessionId): Promise<void> {
    this.clearTimer(sessionId);
    await this.signer.lock(sessionId);
  }
}
