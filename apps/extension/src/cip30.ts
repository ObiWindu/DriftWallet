// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// U023 CIP-30 dApp connector API model (extension-local).
// `getBalance` / `getUtxos` / `signTx` shapes for the Cardano provider shim,
// including the collateral check `signTx` requires. CBOR encoding and
// transport stay in the shell; this module owns validation + error mapping.
import { z } from "zod";

export const CipUtxo = z.object({
  txHash: z.string().regex(/^[0-9a-fA-F]{64}$/),
  index: z.number().int().nonnegative(),
  /** Lovelace as a decimal string (bigint money, no float). */
  lovelace: z.string().regex(/^\d+$/),
  assets: z.record(z.string().min(1), z.string().regex(/^\d+$/)).default({}),
});
export type CipUtxo = z.infer<typeof CipUtxo>;

/** 5 ADA — minimum collateral input `signTx` will accept. */
export const MIN_COLLATERAL_LOVELACE = 5_000_000n;

export const Cip30ErrorCode = z.enum(["refused", "invalid-tx", "no-collateral", "network", "not-enabled"]);
export type Cip30ErrorCode = z.infer<typeof Cip30ErrorCode>;

export class Cip30Exception extends Error {
  readonly code: Cip30ErrorCode;
  constructor(code: Cip30ErrorCode, message: string) {
    super(message);
    this.name = "Cip30Exception";
    this.code = Cip30ErrorCode.parse(code);
  }
}

const CborHex = z.string().regex(/^[0-9a-fA-F]+$/);

/** Sum spendable lovelace across validated UTXOs. */
export function getBalanceLovelace(raw: unknown): bigint {
  const utxos = z.array(CipUtxo).parse(raw);
  return utxos.reduce((sum, u) => sum + BigInt(u.lovelace), 0n);
}

/** List UTXOs, optionally filtered by a minimum lovelace floor. */
export function getUtxos(raw: unknown, minLovelace?: bigint): CipUtxo[] {
  const utxos = z.array(CipUtxo).parse(raw);
  if (minLovelace === undefined) return utxos;
  if (minLovelace < 0n) throw new Error("negative minLovelace");
  return utxos.filter((u) => BigInt(u.lovelace) >= minLovelace);
}

export type CollateralCheck = { ok: true; utxo: CipUtxo } | { ok: false; error: Cip30Exception };

/** Collateral rule: at least one pure-ADA UTXO ≥ 5 ADA (no multi-asset inputs). */
export function checkCollateral(raw: unknown, min: bigint = MIN_COLLATERAL_LOVELACE): CollateralCheck {
  const utxos = z.array(CipUtxo).parse(raw);
  if (min < 0n) throw new Error("negative collateral minimum");
  const candidate = utxos.find(
    (u) => Object.keys(u.assets).length === 0 && BigInt(u.lovelace) >= min,
  );
  if (!candidate) {
    return {
      ok: false,
      error: new Cip30Exception("no-collateral", `no pure-ADA UTXO ≥ ${min} lovelace for collateral`),
    };
  }
  return { ok: true, utxo: candidate };
}

export interface Cip30SignRequest {
  method: "cardano_signTx";
  txCborHex: string;
  partialSign: boolean;
  collateral: CipUtxo | null;
}

/**
 * Build the approval-queue descriptor for `signTx`. Throws `Cip30Exception`
 * (refused/invalid-tx/no-collateral) instead of returning one — the shim
 * maps it straight to the dApp promise rejection.
 */
export function buildCip30SignRequest(
  txCborHex: unknown,
  opts?: { utxos?: unknown; requireCollateral?: boolean; partialSign?: boolean },
): Cip30SignRequest {
  const hex = CborHex.parse(txCborHex);
  if (hex.length < 8) throw new Cip30Exception("invalid-tx", "tx CBOR too short");
  const partialSign = opts?.partialSign ?? false;
  let collateral: CipUtxo | null = null;
  if (opts?.requireCollateral ?? true) {
    const check = checkCollateral(opts?.utxos ?? []);
    if (!check.ok) throw check.error;
    collateral = check.utxo;
  }
  return { method: "cardano_signTx", txCborHex: hex, partialSign, collateral };
}
