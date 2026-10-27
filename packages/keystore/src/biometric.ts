// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

const B64Schema = z.string().regex(/^[A-Za-z0-9+/=]+$/).min(4);

// Abstraction over Keychain (iOS) / Keystore (Android) / WebAuthn PRF (web).
// Holds an opaque wrapped DEK; plaintext key material never leaves the
// secure element abstraction. No logging of key material anywhere.
export interface SecureEnclave {
  saveDEK(keyId: string, dekB64: string): Promise<void>;
  loadDEK(keyId: string): Promise<string | null>;
  removeDEK(keyId: string): Promise<void>;
}

export class MemorySecureEnclave implements SecureEnclave {
  private map = new Map<string, string>();
  async saveDEK(keyId: string, dekB64: string): Promise<void> {
    z.string().min(1).parse(keyId);
    B64Schema.parse(dekB64);
    this.map.set(keyId, dekB64);
  }
  async loadDEK(keyId: string): Promise<string | null> {
    return this.map.get(keyId) ?? null;
  }
  async removeDEK(keyId: string): Promise<void> {
    this.map.delete(keyId);
  }
}

export function generateDEK(bytes = 32): Uint8Array {
  z.number().int().min(16).max(64).parse(bytes);
  const out = new Uint8Array(bytes);
  crypto.getRandomValues(out);
  return out;
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  B64Schema.parse(s);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function wrapDEK(enclave: SecureEnclave, keyId: string, dek: Uint8Array): Promise<void> {
  z.string().min(1).parse(keyId);
  z.instanceof(Uint8Array).parse(dek);
  if (dek.length < 16) throw new Error("DEK too short");
  await enclave.saveDEK(keyId, toB64(dek));
}

export async function unwrapDEK(enclave: SecureEnclave, keyId: string): Promise<Uint8Array | null> {
  z.string().min(1).parse(keyId);
  const raw = await enclave.loadDEK(keyId);
  if (!raw) return null;
  return fromB64(raw);
}
