// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

export const AdaTransfer = z.object({
  fromBech32: z.string().regex(/^addr/),
  toBech32: z.string().regex(/^addr/),
  lovelace: z.string().regex(/^\d+$/),
  derivationPath: z.string().default("m/1852'/1815'/0'/0/0"),
});
export type AdaTransfer = z.infer<typeof AdaTransfer>;

// CIP-1852 path handling (U030): the signer implements full ed25519-bip32,
// so standard paths pass through untouched. Legacy v1 vaults (seed only)
// still use the hardened-only fallback inside the signer.
export function normalizeAdaPath(path: string): string {
  if (!/^m\/1852'\/1815'\/\d+'\/[01]\/\d+$/.test(path.trim())) {
    throw new Error(`bad CIP-1852 path ${path}`);
  }
  return path.trim();
}

export function minAdaLovelace(): bigint {
  return 1_000_000n;
}

// ---------------------------------------------------------------------------
// T006: tx skeleton builder, address validation, witness paths
// ---------------------------------------------------------------------------

const LovelaceStr = z.string().regex(/^\d+$/);
/** Shelley-era bech32 address: addr1… (mainnet) or addr_test1… (testnets). */
const AdaAddr = z.string().regex(/^addr(_test)?1[0-9a-z]+$/);

export const AdaUtxo = z.object({
  txHash: z.string().regex(/^[0-9a-fA-F]{64}$/),
  index: z.number().int().nonnegative(),
  lovelace: LovelaceStr,
});
export type AdaUtxo = z.infer<typeof AdaUtxo>;

export const AdaTxOutput = z.object({
  address: AdaAddr,
  lovelace: LovelaceStr,
});
export type AdaTxOutput = z.infer<typeof AdaTxOutput>;

export const BuildAdaTxInput = z.object({
  inputs: z.array(AdaUtxo).min(1),
  /** Recipient outputs (before change). Each must carry >= min-ADA. */
  outputs: z.array(AdaTxOutput).min(1),
  feeLovelace: LovelaceStr,
  changeAddress: AdaAddr,
});
export type BuildAdaTxInput = z.infer<typeof BuildAdaTxInput>;

export interface AdaTxSkeleton {
  inputs: Array<{ txHash: string; index: number; lovelace: bigint }>;
  outputs: Array<{ address: string; lovelace: bigint }>;
  feeLovelace: bigint;
  changeLovelace: bigint;
  totalInLovelace: bigint;
}

/**
 * Pure ADA transaction skeleton: outputs + fee + change with min-ADA check.
 * Amounts are bigint lovelace; the mesh/CSL tx builder in apps consumes this.
 */
export function buildTxSkeleton(input: z.input<typeof BuildAdaTxInput>): AdaTxSkeleton {
  const p = BuildAdaTxInput.parse(input);
  const MIN = minAdaLovelace();
  const fee = BigInt(p.feeLovelace);
  if (fee <= 0n) throw new Error("fee must be positive");
  const totalIn = p.inputs.reduce((s, u) => s + BigInt(u.lovelace), 0n);
  const outputs = p.outputs.map((o) => ({ address: o.address, lovelace: BigInt(o.lovelace) }));
  for (const o of outputs) {
    if (o.lovelace < MIN) throw new Error(`output below min-ADA ${MIN}`);
    if (!validateAdaAddress(o.address)) throw new Error(`bad ada address ${o.address}`);
  }
  if (!validateAdaAddress(p.changeAddress)) throw new Error(`bad change address ${p.changeAddress}`);
  const outSum = outputs.reduce((s, o) => s + o.lovelace, 0n);
  if (outSum + fee > totalIn) throw new Error("insufficient funds");
  const change = totalIn - outSum - fee;
  if (change !== 0n && change < MIN) throw new Error(`change below min-ADA ${MIN}`);
  const finalOutputs = change === 0n ? outputs : [...outputs, { address: p.changeAddress, lovelace: change }];
  return {
    inputs: p.inputs.map((u) => ({ txHash: u.txHash, index: u.index, lovelace: BigInt(u.lovelace) })),
    outputs: finalOutputs,
    feeLovelace: fee,
    changeLovelace: change,
    totalInLovelace: totalIn,
  };
}

/** Shelley bech32 address sanity: `addr1…`/`addr_test1…`, base32 payload, 58–120 chars. */
export function validateAdaAddress(addr: string): boolean {
  if (typeof addr !== "string") return false;
  if (!/^addr(_test)?1[0-9a-z]+$/.test(addr)) return false;
  return addr.length >= 50 && addr.length <= 120;
}

/**
 * CIP-1852 witness paths for the inputs being spent.
 * `accountIndex` selects the account; roles follow external(0)/change(1) convention.
 */
export function witnessPaths(accountIndex: number, count: number): string[] {
  if (!Number.isInteger(accountIndex) || accountIndex < 0) throw new Error("bad account index");
  if (!Number.isInteger(count) || count <= 0) throw new Error("bad count");
  const paths: string[] = [];
  for (let i = 0; i < count; i++) {
    paths.push(`m/1852'/1815'/${accountIndex}'/0/${i}`);
  }
  return paths;
}
