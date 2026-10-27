// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import { formatFiatCents, parseUnits, scaleCeil } from "../money.js";
import { validateAddress, type FeeLevel, type SendChain } from "../send.js";

// Send screen view-model (U012). Extends `send.ts` address/fee validation
// with bigint-exact amounts: parse with `parseUnits`, quote fees with
// integer ceil scaling, compare against the bigint balance, gate biometrics
// on integer fiat cents. No floats touch money anywhere here.

export const SendFormSchema = z.object({
  chain: z.enum(["ethereum", "solana", "cardano", "bitcoin"]),
  to: z.string().min(1).max(256),
  amountText: z.string().min(1).max(64),
  decimals: z.number().int().min(0).max(36),
  balanceBaseUnits: z.bigint().min(0n),
  medianFeeBaseUnits: z.bigint().min(0n),
  feeLevel: z.enum(["low", "med", "high"]).default("med"),
  priceCents: z.bigint().min(0n),
});
export type SendForm = z.infer<typeof SendFormSchema>;

const FEE_SCALE: Record<FeeLevel, [bigint, bigint]> = {
  low: [4n, 5n],
  med: [1n, 1n],
  high: [3n, 2n],
};

/** Biometric gate threshold: amounts over $100.00 (integer cents). */
export const BIOMETRIC_THRESHOLD_CENTS = 10_000n;

export interface ValidatedSend {
  amountBaseUnits: bigint;
  feeBaseUnits: bigint;
  totalBaseUnits: bigint;
  amountFiatCents: bigint;
  amountFiat: string;
  feeFiat: string;
  biometricRequired: boolean;
}

export type SendFormResult = { ok: true; send: ValidatedSend } | { ok: false; errorKey: string };

export function validateSendForm(input: z.input<typeof SendFormSchema>): SendFormResult {
  const form = SendFormSchema.parse(input);
  if (!validateAddress(form.chain as SendChain, form.to)) {
    return { ok: false, errorKey: "send.invalidAddress" };
  }
  let amount: bigint;
  try {
    amount = parseUnits(form.amountText, form.decimals);
  } catch {
    return { ok: false, errorKey: "send.invalidAmount" };
  }
  if (amount <= 0n) return { ok: false, errorKey: "send.invalidAmount" };
  const [num, den] = FEE_SCALE[form.feeLevel] as [bigint, bigint];
  const fee = scaleCeil(form.medianFeeBaseUnits, num, den);
  if (amount + fee > form.balanceBaseUnits) return { ok: false, errorKey: "send.insufficient" };
  const amountFiatCents = (amount * form.priceCents) / 10n ** BigInt(form.decimals);
  return {
    ok: true,
    send: {
      amountBaseUnits: amount,
      feeBaseUnits: fee,
      totalBaseUnits: amount + fee,
      amountFiatCents,
      amountFiat: formatFiatCents(amount, form.decimals, form.priceCents),
      feeFiat: formatFiatCents(fee, form.decimals, form.priceCents),
      biometricRequired: amountFiatCents > BIOMETRIC_THRESHOLD_CENTS,
    },
  };
}

export interface SendGateResult {
  allowed: boolean;
  biometricRequired: boolean;
  reasonKey: "send.biometricRequired" | "send.confirm";
}

/** Bigint mirror of `send.ts` gateSend: blocks >$100 without biometrics. */
export function sendGate(input: { amountFiatCents: bigint; biometricOk: boolean }): SendGateResult {
  const fiatCents = z.bigint().min(0n).parse(input.amountFiatCents);
  const biometricOk = z.boolean().parse(input.biometricOk);
  const biometricRequired = fiatCents > BIOMETRIC_THRESHOLD_CENTS;
  if (biometricRequired && !biometricOk) {
    return { allowed: false, biometricRequired, reasonKey: "send.biometricRequired" };
  }
  return { allowed: true, biometricRequired, reasonKey: "send.confirm" };
}

// Structural mirror of the @drift/policy-engine Verdict (read-only contract).
export interface PolicyVerdictLike {
  verdict: "allow" | "warn" | "block";
  findings: Array<{ code: string; message: string }>;
}

export function policyBannerProps(v: PolicyVerdictLike): {
  tone: "allow" | "warn" | "block";
  titleKey: "policy.allow" | "policy.warn" | "policy.block";
  findingCount: number;
} {
  const verdict = z.enum(["allow", "warn", "block"]).parse(v.verdict);
  const findings = z.array(z.object({ code: z.string(), message: z.string() })).parse(v.findings);
  const keys = { allow: "policy.allow", warn: "policy.warn", block: "policy.block" } as const;
  return { tone: verdict, titleKey: keys[verdict], findingCount: findings.length };
}
