// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// Send flow helpers (T009). Pure TS — no native deps.
// - Address validation per chain via regex (format only; checksums verified in signer/Rust).
// - Fee picker low/med/high.
// - Biometric gate for amounts > $100 (USD equivalent).

import { z } from "zod";

export type SendChain = "ethereum" | "solana" | "cardano" | "bitcoin";

export const ADDRESS_PATTERNS: Record<SendChain, RegExp> = {
  // 0x + 40 hex chars (checksum verified downstream).
  ethereum: /^0x[0-9a-fA-F]{40}$/,
  // Base58, no 0/O/I/l, 32–44 chars (typical Solana pubkey).
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  // Shelley payment or stake address (bech32 prefix; full validation downstream).
  cardano: /^(addr1|stake1)[0-9a-z]+$/,
  // bech32 bc1... or legacy 1.../3... (format gate only).
  bitcoin: /^(bc1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{11,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/,
};

export function validateAddress(chain: SendChain, address: string): boolean {
  const trimmed = address.trim();
  if (trimmed.length === 0) return false;
  return ADDRESS_PATTERNS[chain].test(trimmed);
}

export type FeeLevel = "low" | "med" | "high";

export interface FeeOption {
  level: FeeLevel;
  /** Relative multiplier vs. median network estimate. */
  multiplier: number;
  /** Target confirmation hint shown in UI. */
  eta: string;
}

export const FEE_OPTIONS: Record<FeeLevel, FeeOption> = {
  low: { level: "low", multiplier: 0.8, eta: "slow (~30 min)" },
  med: { level: "med", multiplier: 1.0, eta: "average (~5 min)" },
  high: { level: "high", multiplier: 1.5, eta: "fast (~1 min)" },
};

export function pickFee(level: FeeLevel): FeeOption {
  return FEE_OPTIONS[level];
}

/** Integer fee multipliers (avoid floats): low 4/5, med 1/1, high 3/2. */
export const FEE_SCALE: Record<FeeLevel, { num: bigint; den: bigint }> = {
  low: { num: 4n, den: 5n },
  med: { num: 1n, den: 1n },
  high: { num: 3n, den: 2n },
};

/** Quote the network fee from a median estimate (minor units as bigint). */
export function quoteFee(medianFeeMinor: bigint, level: FeeLevel): bigint {
  const v = z.bigint().min(0n).parse(medianFeeMinor);
  const scale = FEE_SCALE[level];
  return (v * scale.num + scale.den - 1n) / scale.den;
}

/** Biometric (or device-credential) gate threshold in USD cents. */
export const BIOMETRIC_THRESHOLD_CENTS = 10_000n;

export function requiresBiometric(usdAmountCents: bigint): boolean {
  const v = z.bigint().min(0n).parse(usdAmountCents);
  return v > BIOMETRIC_THRESHOLD_CENTS;
}

export interface SendGate {
  allowed: boolean;
  biometricRequired: boolean;
  reason: string;
}

export function gateSend(usdAmountCents: bigint, biometricOk: boolean): SendGate {
  const biometricRequired = requiresBiometric(usdAmountCents);
  if (biometricRequired && !biometricOk) {
    return { allowed: false, biometricRequired, reason: "biometric-required" };
  }
  return { allowed: true, biometricRequired, reason: "ok" };
}
