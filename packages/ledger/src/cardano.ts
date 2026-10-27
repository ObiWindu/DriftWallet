// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

const CborHex = z.string().regex(/^0x[0-9a-fA-F]+$/);
const WitnessPath = z.string().regex(/^m(\/\d+'?)+$/);
const UintStr = z.string().regex(/^\d+$/);

export const CardanoHardwareInput = z.object({
  txBodyCborHex: CborHex,
  witnessPaths: z.array(WitnessPath).min(1).max(16),
  /** Fee in lovelace, decimal string (bigint money). */
  feeLovelace: UintStr.optional(),
});
export type CardanoHardwareInput = z.infer<typeof CardanoHardwareInput>;

export const CardanoHardwareIntent = z.object({
  chain: z.literal("cardano"),
  txBodyCborHex: CborHex,
  witnessPaths: z.array(z.string()).min(1),
  hardware: z.literal(true),
  feeLovelace: UintStr.optional(),
});
export type CardanoHardwareIntent = z.infer<typeof CardanoHardwareIntent>;

export const CardanoHardwareBuilt = z.object({
  intent: CardanoHardwareIntent,
  display: z.object({ decodedCall: z.string(), warnings: z.array(z.string()) }),
});
export type CardanoHardwareBuilt = z.infer<typeof CardanoHardwareBuilt>;

export function buildCardanoHardwareIntent(input: z.input<typeof CardanoHardwareInput>): CardanoHardwareBuilt {
  const p = CardanoHardwareInput.parse(input);
  const bytes = (p.txBodyCborHex.length - 2) / 2;
  if (bytes <= 0 || bytes > 16_384) throw new Error("cardano tx body out of range");
  if (p.feeLovelace !== undefined && BigInt(p.feeLovelace) < 0n) throw new Error("negative fee");
  // All witness paths must be hardened-only at account level (CIP-1852 style):
  // m/1852'/1815'/<account>'/... — enforce hardened purpose+coin+account.
  for (const w of p.witnessPaths) {
    const parts = w.split("/");
    if (parts[1] !== "1852'" || parts[2] !== "1815'") {
      throw new Error(`non-CIP-1852 witness path ${w}`);
    }
  }
  const intent = CardanoHardwareIntent.parse({
    chain: "cardano",
    txBodyCborHex: p.txBodyCborHex,
    witnessPaths: [...p.witnessPaths],
    hardware: true,
    ...(p.feeLovelace === undefined ? {} : { feeLovelace: p.feeLovelace }),
  });
  const warnings = [
    "Hardware wallet: verify outputs, delegation certificate, and fee on the device screen.",
    `Cardano signing needs ${p.witnessPaths.length} witness key(s).`,
  ];
  return {
    intent,
    display: { decodedCall: `Cardano transaction body (${bytes} bytes CBOR)`, warnings },
  };
}
