// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

// Bigint-only money helpers for @drift/ui (U000).
//
// Contract mirror: these implement the exact semantics of
// @drift/core `formatUnits` / `parseUnits` (read-only reference; see
// packages/core/src/index.ts). The implementation lives here instead of
// importing it because @drift/ui must stay dependency-free of workspace
// packages: @drift/core has no package entry point, and this package's
// tsconfig `rootDir: src` forbids imports outside `src` (TS6059).
// `amount.test.ts` pins the round-trip property
// `parseAmount(formatAmount(x)) === x` so any drift from core is caught.
//
// Rules: no `Number()` / `parseFloat` on balances. Ever.

export const DecimalsSchema = z.number().int().min(0).max(36);
export const AmountTextSchema = z.string().regex(/^\d+(\.\d+)?$/);

/** Format base-unit bigint as a decimal string (no floats). */
export function formatAmount(value: bigint, decimals: number): string {
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

/** Parse a decimal string into base-unit bigint (no floats). */
export function parseAmount(text: string, decimals: number): bigint {
  const d = DecimalsSchema.parse(decimals);
  const t = AmountTextSchema.parse(text.trim());
  const parts = t.split(".") as [string, string?];
  const i = parts[0] as string;
  const f = parts[1] ?? "";
  if (f.length > d) throw new Error("too many decimals");
  const frac = (f + "0".repeat(d)).slice(0, d);
  return BigInt(i === "" ? "0" : i) * 10n ** BigInt(d) + (frac === "" ? 0n : BigInt(frac));
}

/**
 * Sanitize free-form decimal input from a text field.
 * Keeps digits and a single decimal point, caps the fraction at `decimals`,
 * strips leading zeros. Returns "" when nothing numeric remains.
 * Pure and total — never throws for string input.
 */
export function sanitizeDecimalInput(input: string, decimals: number): string {
  const d = DecimalsSchema.parse(decimals);
  const cleaned = input.replace(/[^0-9.]/g, "");
  if (cleaned === "") return "";
  const dot = cleaned.indexOf(".");
  let int = dot === -1 ? cleaned : cleaned.slice(0, dot);
  let frac = dot === -1 ? "" : cleaned.slice(dot + 1).replace(/\./g, "");
  int = int.replace(/^0+(?=\d)/, "");
  if (int === "") int = "0";
  frac = frac.slice(0, d);
  if (d === 0 || frac === "") return int;
  return `${int}.${frac}`;
}

/**
 * Integer-only fiat formatter: `priceCents` is the USD price in whole cents.
 * `formatFiat`-compatible output (`$d.cc`) without touching floats.
 */
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
