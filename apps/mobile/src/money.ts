// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

// Bigint-only money helpers for @drift/mobile (U000, mobile scope).
//
// U000 AUDIT (mobile): `send.ts` is bigint-only. Median fee estimates arrive
// from the gateway and are converted to bigint at the boundary. `screens/send.ts`
// builds on the helpers below and in `send.ts`. No floats touch money.
//
// Contract mirror: same semantics as @drift/core `formatUnits`/`parseUnits`
// (read-only reference). Local copy because neither package has a package
// entry point consumable under this tsconfig (`rootDir: src`).

export const DecimalsSchema = z.number().int().min(0).max(36);

/** Format base-unit bigint as a decimal string (no floats). */
export function formatUnits(value: bigint, decimals: number): string {
  const d = DecimalsSchema.parse(decimals);
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const s = abs.toString().padStart(d + 1, "0");
  const int = s.slice(0, s.length - d);
  let frac = s.slice(s.length - d);
  frac = frac.replace(/0+$/, "");
  const out = frac.length === 0 ? int : `${int}.${frac}`;
  return neg ? `-${out}` : out;
}

export const AmountTextSchema = z.string().regex(/^\d+(\.\d+)?$/);

/** Parse a decimal string into base-unit bigint (no floats). */
export function parseUnits(text: string, decimals: number): bigint {
  const d = DecimalsSchema.parse(decimals);
  const t = AmountTextSchema.parse(text.trim());
  const parts = t.split(".") as [string, string?];
  const i = parts[0] as string;
  const f = parts[1] ?? "";
  if (f.length > d) throw new Error("too many decimals");
  const frac = (f + "0".repeat(d)).slice(0, d);
  return BigInt(i === "" ? "0" : i) * 10n ** BigInt(d) + (frac === "" ? 0n : BigInt(frac));
}

/** Integer-only fiat: price in whole USD cents, result `$d.cc`. */
export function formatFiatCents(amountBaseUnits: bigint, decimals: number, priceCents: bigint): string {
  const d = DecimalsSchema.parse(decimals);
  if (priceCents < 0n) throw new Error("bad price");
  const neg = amountBaseUnits < 0n;
  const abs = neg ? -amountBaseUnits : amountBaseUnits;
  const totalCents = (abs * priceCents) / 10n ** BigInt(d);
  const dollars = totalCents / 100n;
  const cents = (totalCents % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}$${dollars.toString()}.${cents}`;
}

/** Ceil(a * num / den) for positive bigint fee scaling. */
export function scaleCeil(amount: bigint, num: bigint, den: bigint): bigint {
  if (amount < 0n || num <= 0n || den <= 0n) throw new Error("bad scale");
  return (amount * num + den - 1n) / den;
}
