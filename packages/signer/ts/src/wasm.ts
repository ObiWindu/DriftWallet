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

// NOTE: session handles are opaque numbers kept ONLY in WASM linear memory
// (Rust session table). NEVER persist sessions, mnemonics, or passwords to
// localStorage/sessionStorage/IndexedDB — the extension offscreen document
// holds the WASM instance ephemerally and drops it on lock.

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

/**
 * Shape of the wasm-pack generated glue (`wasm-pkg/drift_signer.js`).
 * Every export takes ONE JSON-string request and returns a JSON-string
 * response (`{...}` or `{"error":"..."}`) — the same contract as the UniFFI
 * FFI in `packages/signer/rust/src/ffi.rs`. `default` is wasm-bindgen's
 * `__wbg_init` and must run once before any call.
 */
interface WasmPkg {
  default?(input?: unknown): Promise<unknown>;
  capabilities(): string;
  generate_mnemonic(req: string): string;
  validate_mnemonic(req: string): string;
  entropy_to_vault(req: string): string;
  unlock_vault(req: string): string;
  lock_session(req: string): string;
  derive_pubkey(req: string): string;
  sign_evm(req: string): string;
  sign_solana(req: string): string;
  sign_bitcoin(req: string): string;
  sign_cardano(req: string): string;
}

const REQUIRED_FNS = [
  "generate_mnemonic",
  "validate_mnemonic",
  "entropy_to_vault",
  "unlock_vault",
  "lock_session",
  "derive_pubkey",
  "sign_evm",
  "sign_solana",
  "sign_bitcoin",
  "sign_cardano",
] as const;

function missingPkgError(cause: unknown): Error {
  return new Error(
    "Drift WASM signer package missing at ../wasm-pkg/drift_signer.js. " +
      "Build it with wasm-pack (see packages/signer/ts/wasm.README.md), then record " +
      "its SHA256 in packages/signer/ts/wasm.SHA256. " +
      `Underlying: ${cause instanceof Error ? cause.message : String(cause)}`,
  );
}

function isNode(): boolean {
  return (
    typeof process !== "undefined" &&
    typeof process.versions === "object" &&
    process.versions !== null &&
    typeof process.versions.node === "string"
  );
}

/** Instantiate the wasm module once: bytes from disk in Node, fetch() in the browser. */
async function initWasm(pkg: WasmPkg): Promise<void> {
  if (typeof pkg.default !== "function") return;
  if (isNode()) {
    // Variable specifiers + @vite-ignore keep node builtins out of browser bundles.
    const fsName = "node:fs";
    const urlName = "node:url";
    const fs = (await import(/* @vite-ignore */ fsName)) as typeof import("node:fs");
    const { fileURLToPath } = (await import(/* @vite-ignore */ urlName)) as typeof import("node:url");
    const wasmUrl = new URL("../wasm-pkg/drift_signer_bg.wasm", import.meta.url);
    await pkg.default(fs.readFileSync(fileURLToPath(wasmUrl)));
  } else {
    await pkg.default();
  }
}

async function importWasmPkg(): Promise<WasmPkg> {
  // Non-literal specifier so `tsc` doesn't require the generated file to exist.
  const specifier: string = "../wasm-pkg/drift_signer.js";
  let mod: Record<string, unknown>;
  try {
    mod = (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>;
  } catch (err) {
    throw missingPkgError(err);
  }
  const pkg = mod as unknown as Partial<WasmPkg>;
  for (const fn of REQUIRED_FNS) {
    if (typeof pkg[fn] !== "function") {
      throw missingPkgError(`wasm-pkg export missing: ${fn}`);
    }
  }
  const full = pkg as WasmPkg;
  await initWasm(full);
  return full;
}

/** Call a glue export; unwrap the `{"error":"..."}` envelope into a throw. */
function call<K extends (typeof REQUIRED_FNS)[number]>(
  pkg: WasmPkg,
  fn: K,
  req: unknown,
): Record<string, unknown> {
  const raw = pkg[fn](JSON.stringify(req));
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`signer ${fn}: non-JSON response`);
  }
  const p = parsed as Record<string, unknown>;
  if (typeof p.error === "string") throw new Error(`signer ${fn}: ${p.error}`);
  return p;
}

function pick<T>(parsed: Record<string, unknown>, camel: string, snake: string): T {
  const v = parsed[camel] ?? parsed[snake];
  if (v === undefined) throw new Error(`wasm response missing field: ${camel}`);
  return v as T;
}

/**
 * Load the WASM signer for the extension offscreen document.
 * Maps the wasm-bindgen JSON-string exports onto {@link SignerIface} with zod
 * validation of every input (paths/chains re-checked; Rust re-validates).
 */
export async function loadWasmSigner(): Promise<SignerIface> {
  const wasm = await importWasmPkg();

  return {
    async generateMnemonic(strengthBits) {
      StrengthSchema.parse(strengthBits);
      const p = call(wasm, "generate_mnemonic", { strengthBits });
      return z.string().min(1).parse(pick<string>(p, "mnemonic", "mnemonic"));
    },
    async validateMnemonic(phrase) {
      z.string().min(1).parse(phrase);
      const p = call(wasm, "validate_mnemonic", { phrase });
      return z.boolean().parse(pick<boolean>(p, "valid", "valid"));
    },
    async entropyToVault(phrase, password, lightKdf) {
      z.string().min(1).parse(phrase);
      z.string().min(1).parse(password);
      const p = call(wasm, "entropy_to_vault", { phrase, password, lightKdf: lightKdf === true });
      return VaultSchema.parse(p);
    },
    async unlockVault(vault, password) {
      VaultSchema.parse(vault);
      z.string().min(1).parse(password);
      const p = call(wasm, "unlock_vault", { vault, password });
      return SessionId.parse(pick<number>(p, "sessionId", "session_id"));
    },
    async lock(sessionId) {
      SessionId.parse(sessionId);
      const p = call(wasm, "lock_session", { sessionId });
      if (pick<boolean>(p, "locked", "locked") !== true) throw new Error("signer lock_session: not locked");
    },
    async derivePubkey(sessionId, path, curve) {
      SessionId.parse(sessionId);
      PathSchema.parse(path);
      CurveSchema.parse(curve);
      const p = call(wasm, "derive_pubkey", { sessionId, path, curve });
      return {
        publicKeyHex: HexSchema.parse(pick<string>(p, "publicKeyHex", "public_key_hex")),
        address: z.string().min(1).parse(p.address),
      };
    },
    async signEvm(sessionId, req) {
      SessionId.parse(sessionId);
      PathSchema.parse(req.path);
      ChainSchema.parse(req.chainId);
      const p = call(wasm, "sign_evm", { sessionId, ...req });
      return {
        rawTxHex: HexSchema.parse(pick<string>(p, "rawTxHex", "raw_tx_hex")),
        txHashHex: HexSchema.parse(pick<string>(p, "txHashHex", "tx_hash_hex")),
      };
    },
    async signSolana(sessionId, req) {
      SessionId.parse(sessionId);
      PathSchema.parse(req.path);
      HexSchema.parse(req.messageBytesHex);
      const p = call(wasm, "sign_solana", { sessionId, messageBytesHex: req.messageBytesHex, path: req.path });
      return {
        signatureBase58: z.string().min(1).parse(pick<string>(p, "signatureBase58", "signature_base58")),
        publicKeyBase58: z.string().min(1).parse(pick<string>(p, "publicKeyBase58", "public_key_base58")),
      };
    },
    async signBitcoin(sessionId, req) {
      SessionId.parse(sessionId);
      z.array(z.object({ sighashHex: HexSchema, path: PathSchema })).parse(req.inputs);
      const p = call(wasm, "sign_bitcoin", { sessionId, ...req });
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
      const p = call(wasm, "sign_cardano", { sessionId, ...req });
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
