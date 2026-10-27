// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import {
  CurveSchema,
  SessionId,
  isChainAllowed,
  isPathAllowed,
  type EncryptedVault,
  type SignerIface,
} from "./index.js";

// Mobile-only binding. NEVER import this module on web/extension/node:
// it requires the `react-native` TurboModule `DriftSigner` backed by the
// Rust core (UniFFI). Session handles stay in memory; no seed material is
// ever logged or persisted by this file.

const StrengthSchema = z.union([z.literal(128), z.literal(256)]);
const PathSchema = z
  .string()
  .min(1)
  .refine((p) => isPathAllowed(p), { message: "forbidden derivation path" });
const ChainSchema = z
  .number()
  .int()
  .positive()
  .refine((c) => isChainAllowed(c), { message: "forbidden chain id" });

const VaultSchema = z.object({
  version: z.literal(1),
  saltHex: z.string().min(1),
  nonceHex: z.string().min(1),
  ciphertextHex: z.string().min(1),
  argon2: z.object({ mKib: z.number(), tCost: z.number(), pCost: z.number() }),
});

/** TurboModule surface exposed by Android (Kotlin) / iOS (Swift). */
interface NativeDriftSigner {
  generateMnemonic(strengthBits: number): Promise<string>;
  validateMnemonic(phrase: string): Promise<boolean>;
  entropyToVault(phrase: string, password: string, lightKdf: boolean): Promise<EncryptedVault>;
  unlockVault(vault: EncryptedVault, password: string): Promise<number>;
  lock(sessionId: number): Promise<void>;
  derivePubkey(
    sessionId: number,
    path: string,
    curve: string,
  ): Promise<{ publicKeyHex: string; address: string }>;
  signEvm(
    sessionId: number,
    reqJson: string,
  ): Promise<{ rawTxHex: string; txHashHex: string }>;
  signSolana(
    sessionId: number,
    reqJson: string,
  ): Promise<{ signatureBase58: string; publicKeyBase58: string }>;
  signBitcoin(
    sessionId: number,
    reqJson: string,
  ): Promise<{ signatures: { publicKeyHex: string; derSigHex: string }[] }>;
  signCardano(
    sessionId: number,
    reqJson: string,
  ): Promise<{
    witnesses: { publicKeyHex: string; signatureHex: string }[];
    txBodyHashHex: string;
  }>;
}

const REQUIRED_METHODS = [
  "generateMnemonic",
  "validateMnemonic",
  "entropyToVault",
  "unlockVault",
  "lock",
  "derivePubkey",
  "signEvm",
  "signSolana",
  "signBitcoin",
  "signCardano",
] as const;

async function getNativeModule(): Promise<NativeDriftSigner> {
  let rn: { NativeModules?: Record<string, unknown> } | null = null;
  try {
    // Non-literal specifier: `react-native` exists only in the mobile bundle.
    const specifier: string = "react-native";
    rn = (await import(/* @vite-ignore */ specifier)) as {
      NativeModules?: Record<string, unknown>;
    };
  } catch {
    throw new Error(
      "DriftSigner native module is only available on mobile (react-native). " +
        "Use loadWasmSigner() on web/extension or MockSigner in tests.",
    );
  }
  const holder =
    rn?.NativeModules ?? (globalThis as { NativeModules?: Record<string, unknown> }).NativeModules;
  const native = holder?.DriftSigner as Partial<NativeDriftSigner> | undefined;
  if (!native) {
    throw new Error(
      "NativeModules.DriftSigner not found. Ensure the UniFFI TurboModule is linked " +
        "(see packages/signer/rust/uniffi.toml and android/ios stubs).",
    );
  }
  for (const m of REQUIRED_METHODS) {
    if (typeof native[m] !== "function") {
      throw new Error(`NativeModules.DriftSigner is missing method: ${m}`);
    }
  }
  return native as NativeDriftSigner;
}

/**
 * Load the native UniFFI/JSI TurboModule signer. Mobile only.
 * Validates every input with zod (paths/chains allowlisted; Rust re-validates).
 */
export async function loadNativeSigner(): Promise<SignerIface> {
  const native = await getNativeModule();
  return {
    async generateMnemonic(strengthBits) {
      StrengthSchema.parse(strengthBits);
      return native.generateMnemonic(strengthBits);
    },
    async validateMnemonic(phrase) {
      z.string().min(1).parse(phrase);
      return native.validateMnemonic(phrase);
    },
    async entropyToVault(phrase, password, lightKdf) {
      z.string().min(1).parse(phrase);
      z.string().min(1).parse(password);
      const vault = await native.entropyToVault(phrase, password, lightKdf === true);
      return VaultSchema.parse(vault);
    },
    async unlockVault(vault, password) {
      VaultSchema.parse(vault);
      z.string().min(1).parse(password);
      const id = await native.unlockVault(vault, password);
      return SessionId.parse(id);
    },
    async lock(sessionId) {
      SessionId.parse(sessionId);
      await native.lock(sessionId);
    },
    async derivePubkey(sessionId, path, curve) {
      SessionId.parse(sessionId);
      PathSchema.parse(path);
      CurveSchema.parse(curve);
      return native.derivePubkey(sessionId, path, curve);
    },
    async signEvm(sessionId, req) {
      SessionId.parse(sessionId);
      PathSchema.parse(req.path);
      ChainSchema.parse(req.chainId);
      return native.signEvm(sessionId, JSON.stringify(req));
    },
    async signSolana(sessionId, req) {
      SessionId.parse(sessionId);
      PathSchema.parse(req.path);
      return native.signSolana(sessionId, JSON.stringify(req));
    },
    async signBitcoin(sessionId, req) {
      SessionId.parse(sessionId);
      z.array(z.object({ sighashHex: z.string(), path: PathSchema })).parse(req.inputs);
      return native.signBitcoin(sessionId, JSON.stringify(req));
    },
    async signCardano(sessionId, req) {
      SessionId.parse(sessionId);
      z.array(PathSchema).parse(req.witnessPaths);
      return native.signCardano(sessionId, JSON.stringify(req));
    },
  };
}
