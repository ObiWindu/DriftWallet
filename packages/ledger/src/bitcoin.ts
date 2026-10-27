// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

const UintStr = z.string().regex(/^\d+$/);
const Base64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/);

export const BitcoinHardwareInput = z.object({
  psbtBase64: Base64,
  /** Fee in sats, decimal string (bigint money). */
  feeSats: UintStr,
  feeRateSatVb: UintStr.optional(),
  derivationPath: z
    .string()
    .regex(/^m(\/\d+'?)+$/)
    .default("m/84'/0'/0'/0/0"),
});
export type BitcoinHardwareInput = z.infer<typeof BitcoinHardwareInput>;

export const BitcoinHardwareIntent = z.object({
  chain: z.literal("bitcoin"),
  psbtBase64: Base64,
  feeSats: UintStr,
  feeRateSatVb: z.string().optional(),
  path: z.string(),
  hardware: z.literal(true),
});
export type BitcoinHardwareIntent = z.infer<typeof BitcoinHardwareIntent>;

export const BitcoinHardwareBuilt = z.object({
  intent: BitcoinHardwareIntent,
  display: z.object({ decodedCall: z.string(), warnings: z.array(z.string()) }),
});
export type BitcoinHardwareBuilt = z.infer<typeof BitcoinHardwareBuilt>;

/** Sanity check that the payload looks like a PSBT (magic `psbt\xff`). */
function assertPsbtMagic(b64: string): void {
  let raw: string;
  try {
    raw = atob(b64);
  } catch {
    throw new Error("invalid psbt base64");
  }
  if (raw.length < 5 || raw.slice(0, 5) !== "psbt\xff") throw new Error("not a PSBT (bad magic)");
}

export function buildBitcoinHardwareIntent(input: z.input<typeof BitcoinHardwareInput>): BitcoinHardwareBuilt {
  const p = BitcoinHardwareInput.parse(input);
  assertPsbtMagic(p.psbtBase64);
  const fee = BigInt(p.feeSats);
  if (fee < 0n) throw new Error("negative fee");
  if (p.feeRateSatVb !== undefined && BigInt(p.feeRateSatVb) <= 0n) throw new Error("bad fee rate");
  const intent = BitcoinHardwareIntent.parse({
    chain: "bitcoin",
    psbtBase64: p.psbtBase64,
    feeSats: p.feeSats,
    ...(p.feeRateSatVb === undefined ? {} : { feeRateSatVb: p.feeRateSatVb }),
    path: p.derivationPath,
    hardware: true,
  });
  const warnings = ["Hardware wallet: verify outputs and change on the device screen."];
  if (p.feeRateSatVb !== undefined && BigInt(p.feeRateSatVb) > 500n) {
    warnings.push("Fee rate is very high — confirm you intend to pay this fee.");
  }
  if (fee > 1_000_000n) warnings.push("Absolute fee exceeds 0.01 BTC — double-check before approving.");
  return {
    intent,
    display: { decodedCall: `Bitcoin PSBT (${p.psbtBase64.length} chars, fee ${p.feeSats} sats)`, warnings },
  };
}
