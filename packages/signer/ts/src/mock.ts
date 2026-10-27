// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import {
  isChainAllowed,
  isPathAllowed,
  type AdaSignRequest,
  type BtcSignRequest,
  type Curve,
  type EncryptedVault,
  type EvmSignRequest,
  type SessionId,
  type SignerIface,
  type SolanaSignRequest,
} from "./index.js";

const Phrase12 =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const Phrase24 = `abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art`;

function fnv1aHex(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function mockPubkey(path: string, curve: Curve): string {
  const h = fnv1aHex(`${curve}:${path}`);
  return `02${h.repeat(8).slice(0, 62)}`;
}

function mockAddress(path: string, curve: Curve): string {
  const h = fnv1aHex(`addr:${curve}:${path}`);
  return curve === "Ed25519" ? `mockAddr${h}` : `0xmock${h}`;
}

/**
 * Deterministic MockSigner for unit tests. Mimics the Rust contract:
 * wrong password fails, unknown session fails, forbidden paths/chains fail.
 * Holds no real key material — sessions map opaque handle -> phrase string.
 */
export class MockSigner implements SignerIface {
  readonly _sessions = new Map<number, string>();
  private readonly vaults = new Map<string, { phrase: string; password: string }>();
  private next = 1;

  async generateMnemonic(strengthBits: 128 | 256): Promise<string> {
    const parsed = z.union([z.literal(128), z.literal(256)]).safeParse(strengthBits);
    if (!parsed.success) throw new Error("invalid strength: must be 128 or 256");
    return strengthBits === 128 ? Phrase12 : Phrase24;
  }

  async validateMnemonic(phrase: string): Promise<boolean> {
    const words = phrase.trim().split(/\s+/);
    return words.length === 12 || words.length === 24;
  }

  async entropyToVault(phrase: string, password: string, _lightKdf?: boolean): Promise<EncryptedVault> {
    if (!(await this.validateMnemonic(phrase))) throw new Error("invalid mnemonic");
    if (!password) throw new Error("password required");
    const v: EncryptedVault = {
      version: 1,
      saltHex: "00".repeat(32),
      nonceHex: "00".repeat(24),
      ciphertextHex: Buffer.from(`${phrase}::${password}`, "utf8").toString("hex"),
      argon2: { mKib: 8192, tCost: 1, pCost: 1 },
    };
    this.vaults.set(v.ciphertextHex, { phrase, password });
    return v;
  }

  async unlockVault(vault: EncryptedVault, password: string): Promise<SessionId> {
    const rec = this.vaults.get(vault.ciphertextHex);
    if (rec) {
      if (rec.password !== password) throw new Error("wrong password");
      const id = this.next++ as SessionId;
      this._sessions.set(id, rec.phrase);
      return id;
    }
    // Fallback: stateless decode for vaults built by the same deterministic
    // encoding (supports cross-instance roundtrips in tests).
    let decoded = "";
    try {
      decoded = Buffer.from(vault.ciphertextHex, "hex").toString("utf8");
    } catch {
      throw new Error("wrong password");
    }
    const sep = decoded.lastIndexOf("::");
    if (sep < 0) throw new Error("wrong password");
    const phrase = decoded.slice(0, sep);
    const expected = decoded.slice(sep + 2);
    if (expected !== password) throw new Error("wrong password");
    if (!(await this.validateMnemonic(phrase))) throw new Error("wrong password");
    const id = this.next++ as SessionId;
    this._sessions.set(id, phrase);
    return id;
  }

  async lock(sessionId: SessionId): Promise<void> {
    if (!this._sessions.has(sessionId)) throw new Error("bad session");
    this._sessions.delete(sessionId);
  }

  private requireSession(sessionId: SessionId): string {
    const phrase = this._sessions.get(sessionId);
    if (!phrase) throw new Error("bad session");
    return phrase;
  }

  async derivePubkey(
    sessionId: SessionId,
    path: string,
    curve: Curve,
  ): Promise<{ publicKeyHex: string; address: string }> {
    this.requireSession(sessionId);
    if (!isPathAllowed(path)) throw new Error(`forbidden derivation path: ${path}`);
    if (curve !== "Secp256k1" && curve !== "Ed25519") throw new Error("unknown curve");
    return { publicKeyHex: mockPubkey(path, curve), address: mockAddress(path, curve) };
  }

  async signEvm(
    sessionId: SessionId,
    req: EvmSignRequest,
  ): Promise<{ rawTxHex: string; txHashHex: string }> {
    this.requireSession(sessionId);
    if (!isChainAllowed(req.chainId)) throw new Error(`forbidden chain id: ${req.chainId}`);
    if (!isPathAllowed(req.path)) throw new Error(`forbidden derivation path: ${req.path}`);
    const h = fnv1aHex(`${sessionId}:${req.chainId}:${req.nonce}:${req.path}`);
    return { rawTxHex: `0x02mock${h}`, txHashHex: `0xmock${h}` };
  }

  async signSolana(
    sessionId: SessionId,
    req: SolanaSignRequest,
  ): Promise<{ signatureBase58: string; publicKeyBase58: string }> {
    this.requireSession(sessionId);
    if (!isPathAllowed(req.path)) throw new Error(`forbidden derivation path: ${req.path}`);
    const h = fnv1aHex(`${sessionId}:${req.messageBytesHex}:${req.path}`);
    return { signatureBase58: `mockSig${h}`, publicKeyBase58: `mockPk${h}` };
  }

  async signBitcoin(
    sessionId: SessionId,
    req: BtcSignRequest,
  ): Promise<{ signatures: { publicKeyHex: string; derSigHex: string }[] }> {
    this.requireSession(sessionId);
    for (const inp of req.inputs) {
      if (!isPathAllowed(inp.path)) throw new Error(`forbidden derivation path: ${inp.path}`);
    }
    return {
      signatures: req.inputs.map((inp, i) => ({
        publicKeyHex: mockPubkey(inp.path, "Secp256k1"),
        derSigHex: `mockdersig${fnv1aHex(`${sessionId}:${inp.sighashHex}:${i}`)}01`,
      })),
    };
  }

  async signCardano(
    sessionId: SessionId,
    req: AdaSignRequest,
  ): Promise<{ witnesses: { publicKeyHex: string; signatureHex: string }[]; txBodyHashHex: string }> {
    this.requireSession(sessionId);
    for (const p of req.witnessPaths) {
      if (!isPathAllowed(p)) throw new Error(`forbidden derivation path: ${p}`);
    }
    const txBodyHashHex = fnv1aHex(req.txBodyCborHex).repeat(8).slice(0, 64);
    return {
      witnesses: req.witnessPaths.map((p) => ({
        publicKeyHex: mockPubkey(p, "Ed25519"),
        signatureHex: `mockada${fnv1aHex(`${sessionId}:${p}:${req.txBodyCborHex}`)}`.repeat(2).slice(0, 128),
      })),
      txBodyHashHex,
    };
  }
}

export function createMockSigner(): MockSigner {
  return new MockSigner();
}
