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
  /** Fires when a session was opened with the DURESS password (decoy vault). */
  onDuressUnlock?: (sessionId: SessionId) => void;
}

export interface UnlockResult {
  sessionId: SessionId;
  /** True when unlocked with the duress password (decoy vault, limited view). */
  duress: boolean;
}

export interface SpendState {
  spentBaseUnits: bigint;
  limitBaseUnits: bigint | null;
  remainingBaseUnits: bigint | null;
}

const DURESS_SUFFIX = ".duress";

export class Keystore {
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  private sessions = new Set<number>();
  private spend = new Map<number, { spent: bigint; limit: bigint | null }>();
  private vaultIds = new Set<string>();
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
    this.vaultIds.add(vaultId);
    return { vaultRef: { vaultId, version: 1, storedAt: Date.now() } };
  }

  async importWallet(phrase: string, password: string): Promise<{ vaultRef: VaultRef }> {
    if (password.length < 8) throw new Error("password too short (min 8)");
    if (!(await this.signer.validateMnemonic(phrase.trim()))) throw new Error("invalid mnemonic");
    const vault = await this.signer.entropyToVault(phrase.trim(), password);
    const vaultId = `vault_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    await this.storage.save(vaultId, vault);
    this.vaultIds.add(vaultId);
    return { vaultRef: { vaultId, version: 1, storedAt: Date.now() } };
  }

  /**
   * Set up a duress PIN: a second, decoy vault (fresh random 128-bit mnemonic)
   * encrypted with the duress password and stored under `<vaultId>.duress`.
   * Under coercion the user types the duress PIN, gets the decoy wallet, and
   * the app fires `onDuressUnlock` so it can log/alert. The main vault is
   * verified with `mainPassword` first so a duress vault is never attached to
   * a vault the caller does not control.
   */
  async setupDuress(vaultRef: VaultRef, mainPassword: string, duressPassword: string): Promise<{ duressVaultId: string }> {
    if (duressPassword.length < 8) throw new Error("duress password too short (min 8)");
    const v = await this.storage.load(vaultRef.vaultId);
    if (!v) throw new Error("vault not found");
    const check = await this.signer.unlockVault(v, mainPassword);
    await this.signer.lock(check); // verify main password, then close the probe session
    const decoyPhrase = await this.signer.generateMnemonic(128);
    const duressVault = await this.signer.entropyToVault(decoyPhrase, duressPassword);
    const duressVaultId = `${vaultRef.vaultId}${DURESS_SUFFIX}`;
    await this.storage.save(duressVaultId, duressVault);
    return { duressVaultId };
  }

  async hasDuress(vaultRef: VaultRef): Promise<boolean> {
    return (await this.storage.load(`${vaultRef.vaultId}${DURESS_SUFFIX}`)) !== null;
  }

  async unlock(vaultRef: VaultRef, password: string): Promise<UnlockResult> {
    const v = await this.storage.load(vaultRef.vaultId);
    if (!v) throw new Error("vault not found");
    try {
      const sessionId = await this.signer.unlockVault(v, password);
      this.sessions.add(sessionId);
      this.spend.set(sessionId, { spent: 0n, limit: null });
      this.armAutoLock(sessionId);
      return { sessionId, duress: false };
    } catch {
      // fall through to duress vault
    }
    const dv = await this.storage.load(`${vaultRef.vaultId}${DURESS_SUFFIX}`);
    if (dv) {
      try {
        const sessionId = await this.signer.unlockVault(dv, password);
        this.sessions.add(sessionId);
        this.spend.set(sessionId, { spent: 0n, limit: null });
        this.armAutoLock(sessionId);
        this.opts.events?.onDuressUnlock?.(sessionId);
        return { sessionId, duress: true };
      } catch {
        // fall through
      }
    }
    throw new Error("invalid password");
  }

  async lock(sessionId: SessionId): Promise<void> {
    this.clearTimer(sessionId);
    this.sessions.delete(sessionId);
    this.spend.delete(sessionId);
    await this.signer.lock(sessionId);
  }

  /** Lock every active session (app backgrounded / manual lock-all). */
  async lockAll(): Promise<void> {
    for (const s of [...this.sessions]) {
      await this.lock(s);
    }
  }

  /**
   * Panic wipe: lock all sessions and delete every vault (incl. duress)
   * from storage. Irreversible by design.
   */
  async wipeAll(): Promise<void> {
    await this.lockAll();
    for (const id of [...this.vaultIds]) {
      await this.storage.remove(id);
      await this.storage.remove(`${id}${DURESS_SUFFIX}`);
    }
    this.vaultIds.clear();
  }

  // ---- per-session spending limits (policy-engine enforces at approval) ----

  setSpendLimit(sessionId: SessionId, limitBaseUnits: bigint | null): void {
    if (!this.sessions.has(sessionId)) throw new Error("unknown session");
    if (limitBaseUnits !== null && limitBaseUnits <= 0n) throw new Error("limit must be > 0");
    const st = this.spend.get(sessionId);
    this.spend.set(sessionId, { spent: st?.spent ?? 0n, limit: limitBaseUnits });
  }

  /**
   * Record a signed spend against the session limit. Throws
   * SPEND_LIMIT_EXCEEDED when the tx would exceed the limit — the caller must
   * NOT sign in that case.
   */
  recordSpend(sessionId: SessionId, amountBaseUnits: bigint | string): SpendState {
    if (!this.sessions.has(sessionId)) throw new Error("unknown session");
    const amt = BigInt(z.string().regex(/^\d+$/).parse(String(amountBaseUnits)));
    const st = this.spend.get(sessionId) ?? { spent: 0n, limit: null };
    if (st.limit !== null && st.spent + amt > st.limit) {
      throw new Error("SPEND_LIMIT_EXCEEDED");
    }
    const spent = st.spent + amt;
    this.spend.set(sessionId, { spent, limit: st.limit });
    return { spentBaseUnits: spent, limitBaseUnits: st.limit, remainingBaseUnits: st.limit === null ? null : st.limit - spent };
  }

  getSpend(sessionId: SessionId): SpendState {
    if (!this.sessions.has(sessionId)) throw new Error("unknown session");
    const st = this.spend.get(sessionId) ?? { spent: 0n, limit: null };
    return { spentBaseUnits: st.spent, limitBaseUnits: st.limit, remainingBaseUnits: st.limit === null ? null : st.limit - st.spent };
  }
}
