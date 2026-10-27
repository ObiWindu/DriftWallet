// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

const MessageBytesHex = z.string().regex(/^0x[0-9a-fA-F]+$/);
const UintStr = z.string().regex(/^\d+$/);

export const SolanaHardwareInput = z.object({
  messageBytesHex: MessageBytesHex,
  derivationPath: z
    .string()
    .regex(/^m(\/\d+'?)+$/)
    .default("m/44'/501'/0'/0'"),
  /** Fee in lamports, decimal string (bigint money). */
  feeLamports: UintStr.optional(),
});
export type SolanaHardwareInput = z.infer<typeof SolanaHardwareInput>;

export const SolanaHardwareIntent = z.object({
  chain: z.literal("solana"),
  messageBytesHex: MessageBytesHex,
  path: z.string(),
  hardware: z.literal(true),
  feeLamports: UintStr.optional(),
});
export type SolanaHardwareIntent = z.infer<typeof SolanaHardwareIntent>;

export const SolanaHardwareBuilt = z.object({
  intent: SolanaHardwareIntent,
  display: z.object({ decodedCall: z.string(), warnings: z.array(z.string()) }),
});
export type SolanaHardwareBuilt = z.infer<typeof SolanaHardwareBuilt>;

export function buildSolanaHardwareIntent(input: z.input<typeof SolanaHardwareInput>): SolanaHardwareBuilt {
  const p = SolanaHardwareInput.parse(input);
  const bytes = (p.messageBytesHex.length - 2) / 2;
  if (!Number.isInteger(bytes) || bytes <= 0) throw new Error("empty solana message");
  if (bytes > 1232) throw new Error("solana message too large");
  if (p.feeLamports !== undefined) {
    const fee = BigInt(p.feeLamports);
    if (fee < 0n) throw new Error("negative fee");
  }
  const intent = SolanaHardwareIntent.parse({
    chain: "solana",
    messageBytesHex: p.messageBytesHex,
    path: p.derivationPath,
    hardware: true,
    ...(p.feeLamports === undefined ? {} : { feeLamports: p.feeLamports }),
  });
  const warnings = ["Hardware wallet: verify recipient and amount on the device screen."];
  if (p.feeLamports !== undefined && BigInt(p.feeLamports) > 100_000n) {
    warnings.push("Fee is unusually high for Solana — double-check before approving.");
  }
  return {
    intent,
    display: { decodedCall: `Solana transaction (${bytes} bytes)`, warnings },
  };
}
