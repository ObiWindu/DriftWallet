// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import {
  CurveSchema,
  SessionId,
  isChainAllowed,
  isPathAllowed,
  type SignerIface,
} from "./index.js";

// NOTE: session handles are opaque numbers kept ONLY in memory (closure
// scope / in-Rust session table). NEVER persist sessions, mnemonics, or
// passwords to localStorage/sessionStorage/IndexedDB — the extension
// offscreen document holds the WASM instance ephemerally and drops it on lock.

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
const HexSchema = z.string().regex(/^(0x)?[0-9a-fA-F]*$/);

const VaultSchema = z.object({
  version: z.literal(1),
  saltHex: z.string().min(1),
  nonceHex: z.string().min(1),
  ciphertextHex: z.string().min(1),
  argon2: z.object({ mKib: z.number(), tCost: z.number(), pCost: z.number() }),
});

/** Expected shape of the wasm-pack generated glue (`wasm-pkg/drift_signer.js`). */
interface WasmPkg {
  generate_mnemonic(strength_bits: number): string;
  validate_mnemonic(phrase: string): boolean;
  entropy_to_vault(phrase: string, password: string, light_kdf: boolean): string;
  unlock_vault(vault_json: string, password: string): number;
  lock(session_id: number): void;
  derive_pubkey(session_id: number, path: string, curve: string): string;
  sign_evm(session_id: number, req_json: string): string;
  sign_solana(session_id: number, req_json: string): string;
  sign_bitcoin(session_id: number, req_json: string): string;
  sign_cardano(session_id: number, req_json: string): string;
}

function pick<T>(parsed: unknown, camel: string, snake: string): T {
  const o = parsed as Record<string, T | undefined>;
  const v = o[camel] ?? o[snake];
  if (v === undefined) throw new Error(`wasm response missing field: ${camel}`);
  return v;
}

async function importWasmPkg(): Promise<WasmPkg> {
  // Non-literal specifier so `tsc` doesn't require the generated file to exist.
  const specifier: string = "../wasm-pkg/drift_signer.js";
  try {
    const mod = (await import(/* @vite-ignore */ specifier)) as Partial<WasmPkg> & {
      default?: unknown;
    };
    const pkg = (mod.default ?? mod) as Partial<WasmPkg>;
    for (const fn of [
      "generate_mnemonic",
      "entropy_to_vault",
      "unlock_vault",
      "lock",
      "derive_pubkey",
      "sign_evm",
      "sign_solana",
      "sign_bitcoin",
      "sign_cardano",
    ] as const) {
      if (typeof pkg[fn] !== "function") {
        throw new Error(`wasm-pkg export missing: ${fn}`);
      }
    }
    return pkg as WasmPkg;
  } catch (err) {
    throw new Error(
      "Drift WASM signer package missing at ../wasm-pkg/drift_signer.js. " +
        "Build it with wasm-pack (see packages/signer/ts/wasm.README.md), then record " +
        "its SHA256 in packages/signer/ts/wasm.SHA256. " +
        `Underlying: ${(err as Error).message}`,
    );
  }
}

/**
 * Load the WASM signer for the extension offscreen document.
 * Maps wasm-pack JSON-string exports onto {@link SignerIface} with zod
 * validation of every input (paths/chains re-checked; Rust re-validates).
 */
export async function loadWasmSigner(): Promise<SignerIface> {
  const wasm = await importWasmPkg();

  return {
    async generateMnemonic(strengthBits) {
      StrengthSchema.parse(strengthBits);
      return wasm.generate_mnemonic(strengthBits);
    },
    async validateMnemonic(phrase) {
      z.string().min(1).parse(phrase);
      return wasm.validate_mnemonic(phrase);
    },
    async entropyToVault(phrase, password, lightKdf) {
      z.string().min(1).parse(phrase);
      z.string().min(1).parse(password);
      const raw = wasm.entropy_to_vault(phrase, password, lightKdf === true);
      return VaultSchema.parse(JSON.parse(raw));
    },
    async unlockVault(vault, password) {
      VaultSchema.parse(vault);
      z.string().min(1).parse(password);
      const id = wasm.unlock_vault(JSON.stringify(vault), password);
      return SessionId.parse(id);
    },
    async lock(sessionId) {
      SessionId.parse(sessionId);
      wasm.lock(sessionId);
    },
    async derivePubkey(sessionId, path, curve) {
      SessionId.parse(sessionId);
      PathSchema.parse(path);
      CurveSchema.parse(curve);
      const raw = wasm.derive_pubkey(sessionId, path, curve);
      const p = JSON.parse(raw) as Record<string, string>;
      return {
        publicKeyHex: HexSchema.parse(pick<string>(p, "publicKeyHex", "public_key_hex")),
        address: z.string().min(1).parse(p.address),
      };
    },
    async signEvm(sessionId, req) {
      SessionId.parse(sessionId);
      PathSchema.parse(req.path);
      ChainSchema.parse(req.chainId);
      const raw = wasm.sign_evm(sessionId, JSON.stringify(req));
      const p = JSON.parse(raw) as Record<string, string>;
      return {
        rawTxHex: HexSchema.parse(pick<string>(p, "rawTxHex", "raw_tx_hex")),
        txHashHex: HexSchema.parse(pick<string>(p, "txHashHex", "tx_hash_hex")),
      };
    },
    async signSolana(sessionId, req) {
      SessionId.parse(sessionId);
      PathSchema.parse(req.path);
      const raw = wasm.sign_solana(sessionId, JSON.stringify(req));
      const p = JSON.parse(raw) as Record<string, string>;
      return {
        signatureBase58: z.string().min(1).parse(pick<string>(p, "signatureBase58", "signature_base58")),
        publicKeyBase58: z.string().min(1).parse(pick<string>(p, "publicKeyBase58", "public_key_base58")),
      };
    },
    async signBitcoin(sessionId, req) {
      SessionId.parse(sessionId);
      z.array(z.object({ sighashHex: HexSchema, path: PathSchema })).parse(req.inputs);
      const raw = wasm.sign_bitcoin(sessionId, JSON.stringify(req));
      const p = JSON.parse(raw) as {
        signatures?: { publicKeyHex?: string; derSigHex?: string; public_key_hex?: string; der_sig_hex?: string }[];
      };
      const sigs = z.array(z.object({}).passthrough()).parse(p.signatures ?? []);
      return {
        signatures: sigs.map((s) => {
          const r = s as Record<string, string>;
          return {
            publicKeyHex: HexSchema.parse(r.publicKeyHex ?? r.public_key_hex),
            derSigHex: HexSchema.parse(r.derSigHex ?? r.der_sig_hex),
          };
        }),
      };
    },
    async signCardano(sessionId, req) {
      SessionId.parse(sessionId);
      z.array(PathSchema).parse(req.witnessPaths);
      const raw = wasm.sign_cardano(sessionId, JSON.stringify(req));
      const p = JSON.parse(raw) as Record<string, unknown>;
      const witnesses = z.array(z.object({}).passthrough()).parse(p.witnesses ?? []);
      return {
        witnesses: witnesses.map((w) => {
          const r = w as Record<string, string>;
          return {
            publicKeyHex: HexSchema.parse(r.publicKeyHex ?? r.public_key_hex),
            signatureHex: HexSchema.parse(r.signatureHex ?? r.signature_hex),
          };
        }),
        txBodyHashHex: HexSchema.parse((p.txBodyHashHex ?? p.tx_body_hash_hex) as string),
      };
    },
  };
}
