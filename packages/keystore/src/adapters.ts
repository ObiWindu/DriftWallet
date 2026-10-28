// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import type { EncryptedVault, VaultStorage } from "./index.js";

export const EncryptedVaultSchema = z.object({
  version: z.literal(1),
  saltHex: z.string().regex(/^[0-9a-f]+$/i).min(2),
  nonceHex: z.string().regex(/^[0-9a-f]+$/i).min(2),
  ciphertextHex: z.string().regex(/^[0-9a-f]+$/i).min(2),
  argon2: z.object({
    mKib: z.number().int().positive(),
    tCost: z.number().int().positive(),
    pCost: z.number().int().positive(),
  }),
});

function parseVaultBlob(raw: unknown): EncryptedVault {
  // Zod-validate on load; never log plaintext or blob contents.
  const parsed = EncryptedVaultSchema.parse(raw);
  return {
    version: 1,
    saltHex: parsed.saltHex,
    nonceHex: parsed.nonceHex,
    ciphertextHex: parsed.ciphertextHex,
    argon2: { ...parsed.argon2 },
  };
}

// ---- Encrypted MMKV stub (React Native) ----
// Production: react-native-mmkv with `cryptKey` (encryptionKey).
// This stub keeps the same constructor shape with an in-memory map so
// unit tests run without native modules. No plaintext is logged.
export class MmkvStorage implements VaultStorage {
  private map = new Map<string, EncryptedVault>();
  constructor(opts: { cryptKey: string; instanceId?: string }) {
    const key = z.object({ cryptKey: z.string().min(1) }).parse(opts).cryptKey;
    void key;
    void opts.instanceId;
  }
  async save(vaultId: string, vault: EncryptedVault): Promise<void> {
    z.string().min(1).parse(vaultId);
    parseVaultBlob(vault);
    this.map.set(vaultId, { ...vault, argon2: { ...vault.argon2 } });
  }
  async load(vaultId: string): Promise<EncryptedVault | null> {
    const raw = this.map.get(vaultId) ?? null;
    if (!raw) return null;
    return parseVaultBlob(structuredCloneSafe(raw));
  }
  async remove(vaultId: string): Promise<void> {
    this.map.delete(vaultId);
  }
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ---- Minimal browser storage typings (no @types/chrome needed) ----
interface ChromeLocalArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}
interface ChromeSessionArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}
function chromeLocal(): ChromeLocalArea | null {
  const g = globalThis as unknown as { chrome?: { storage?: { local?: ChromeLocalArea } } };
  return g.chrome?.storage?.local ?? null;
}
function chromeSession(): ChromeSessionArea | null {
  const g = globalThis as unknown as { chrome?: { storage?: { session?: ChromeSessionArea } } };
  return g.chrome?.storage?.session ?? null;
}
function browserLocal(): ChromeLocalArea | null {
  const g = globalThis as unknown as { browser?: { storage?: { local?: ChromeLocalArea } } };
  return g.browser?.storage?.local ?? null;
}
function browserSession(): ChromeSessionArea | null {
  const g = globalThis as unknown as { browser?: { storage?: { session?: ChromeSessionArea } } };
  return g.browser?.storage?.session ?? null;
}

function vaultKey(vaultId: string): string {
  return `drift:vault:${vaultId}`;
}

// ---- Chrome: ciphertext in chrome.storage.local, session id in chrome.storage.session ----
export class ChromeStorageAdapter implements VaultStorage {
  private fallback = new Map<string, EncryptedVault>();
  private fallbackSession = new Map<string, string>();

  async save(vaultId: string, vault: EncryptedVault): Promise<void> {
    z.string().min(1).parse(vaultId);
    parseVaultBlob(vault);
    const area = chromeLocal();
    const blob = structuredCloneSafe(vault);
    if (!area) {
      this.fallback.set(vaultId, blob);
      return;
    }
    await area.set({ [vaultKey(vaultId)]: blob });
  }
  async load(vaultId: string): Promise<EncryptedVault | null> {
    const area = chromeLocal();
    if (!area) {
      const hit = this.fallback.get(vaultId) ?? null;
      return hit ? parseVaultBlob(structuredCloneSafe(hit)) : null;
    }
    const res = await area.get(vaultKey(vaultId));
    const raw = res[vaultKey(vaultId)] ?? null;
    if (!raw) return null;
    return parseVaultBlob(raw);
  }
  async remove(vaultId: string): Promise<void> {
    const area = chromeLocal();
    if (!area) {
      this.fallback.delete(vaultId);
      return;
    }
    await area.remove(vaultKey(vaultId));
  }

  async saveSessionId(vaultId: string, sessionId: number): Promise<void> {
    z.string().min(1).parse(vaultId);
    z.number().int().nonnegative().parse(sessionId);
    const area = chromeSession();
    if (!area) {
      this.fallbackSession.set(vaultId, String(sessionId));
      return;
    }
    await area.set({ [`drift:session:${vaultId}`]: sessionId });
  }
  async loadSessionId(vaultId: string): Promise<number | null> {
    const area = chromeSession();
    if (!area) {
      const hit = this.fallbackSession.get(vaultId);
      return hit === undefined ? null : z.coerce.number().int().parse(hit);
    }
    const res = await area.get(`drift:session:${vaultId}`);
    const raw = res[`drift:session:${vaultId}`];
    if (raw === undefined || raw === null) return null;
    return z.coerce.number().int().nonnegative().parse(raw);
  }
}

// ---- Firefox: browser.* variant ----
export class FirefoxStorageAdapter implements VaultStorage {
  private fallback = new Map<string, EncryptedVault>();
  private fallbackSession = new Map<string, string>();

  async save(vaultId: string, vault: EncryptedVault): Promise<void> {
    z.string().min(1).parse(vaultId);
    parseVaultBlob(vault);
    const area = browserLocal();
    const blob = structuredCloneSafe(vault);
    if (!area) {
      this.fallback.set(vaultId, blob);
      return;
    }
    await area.set({ [vaultKey(vaultId)]: blob });
  }
  async load(vaultId: string): Promise<EncryptedVault | null> {
    const area = browserLocal();
    if (!area) {
      const hit = this.fallback.get(vaultId) ?? null;
      return hit ? parseVaultBlob(structuredCloneSafe(hit)) : null;
    }
    const res = await area.get(vaultKey(vaultId));
    const raw = res[vaultKey(vaultId)] ?? null;
    if (!raw) return null;
    return parseVaultBlob(raw);
  }
  async remove(vaultId: string): Promise<void> {
    const area = browserLocal();
    if (!area) {
      this.fallback.delete(vaultId);
      return;
    }
    await area.remove(vaultKey(vaultId));
  }

  async saveSessionId(vaultId: string, sessionId: number): Promise<void> {
    z.string().min(1).parse(vaultId);
    z.number().int().nonnegative().parse(sessionId);
    const area = browserSession();
    if (!area) {
      this.fallbackSession.set(vaultId, String(sessionId));
      return;
    }
    await area.set({ [`drift:session:${vaultId}`]: sessionId });
  }
  async loadSessionId(vaultId: string): Promise<number | null> {
    const area = browserSession();
    if (!area) {
      const hit = this.fallbackSession.get(vaultId);
      return hit === undefined ? null : z.coerce.number().int().parse(hit);
    }
    const res = await area.get(`drift:session:${vaultId}`);
    const raw = res[`drift:session:${vaultId}`];
    if (raw === undefined || raw === null) return null;
    return z.coerce.number().int().nonnegative().parse(raw);
  }
}
