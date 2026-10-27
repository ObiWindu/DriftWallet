// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// Popup portfolio render model (T010, U000 float fix).
// Pure TS — no framework imports.
//
// U000: bigint-only money. `buildPortfolioModel` never touches Number() or
// parseFloat on balances or fiat: amounts stay as bigint minor units, prices
// become integer cents, and `valueUsd`/`totalUsd` are rendered as fixed
// 2-decimal strings from integer cents. Exact string prices ("2999.99") are
// preferred; plain numbers are rounded to the nearest cent once, at the
// boundary, and never flow through float arithmetic afterwards.

import { z } from "zod";

export interface PortfolioAsset {
  chain: string;
  symbol: string;
  balanceMinor: string;
  decimals: number;
  /** Exact decimal string ("2999.99") preferred; number rounded to cents. */
  priceUsd: number | string;
}

export interface PortfolioModel {
  totalUsd: string;
  rows: Array<{
    chain: string;
    symbol: string;
    balance: string;
    valueUsd: string;
  }>;
  updatedAt: string;
}

const AssetSchema = z.object({
  chain: z.string().min(1),
  symbol: z.string().min(1),
  balanceMinor: z.string().regex(/^-?\d+$/),
  decimals: z.number().int().min(0).max(36),
  priceUsd: z.union([z.number().finite().nonnegative(), z.string().regex(/^\d+(\.\d{1,2})?$/)]),
});

export function formatBalance(balanceMinor: string, decimals: number): string {
  const raw = z.string().regex(/^-?\d+$/).parse(balanceMinor);
  const dec = z.number().int().min(0).max(36).parse(decimals);
  const neg = raw.startsWith("-");
  const digits = neg ? raw.slice(1) : raw;
  const padded = digits.padStart(dec + 1, "0");
  const head = dec === 0 ? padded : padded.slice(0, padded.length - dec);
  const tail = dec === 0 ? "" : padded.slice(padded.length - dec).replace(/0+$/, "");
  const body = tail.length > 0 ? `${head}.${tail}` : head;
  return neg ? `-${body}` : body;
}

/** Inverse of `formatBalance` for validated human strings. Throws on bad input. */
export function parseBalance(text: string, decimals: number): bigint {
  const dec = z.number().int().min(0).max(36).parse(decimals);
  const t = z.string().min(1).parse(text).trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(t);
  if (!m) throw new Error(`bad amount: ${text}`);
  const [, sign, intPart = "0", fracPart = ""] = m;
  if (fracPart.length > dec) throw new Error(`too many decimals: ${text}`);
  const frac = (fracPart + "0".repeat(dec)).slice(0, dec);
  const abs = BigInt(intPart) * 10n ** BigInt(dec) + (frac === "" ? 0n : BigInt(frac));
  return sign === "-" ? -abs : abs;
}

/** Price → integer cents. Numbers round once at the boundary; strings exact. */
export function priceToCents(priceUsd: number | string): bigint {
  if (typeof priceUsd === "string") {
    const p = z.string().regex(/^\d+(\.\d{1,2})?$/).parse(priceUsd.trim());
    const [d, c = ""] = p.split(".") as [string, string];
    return BigInt(d) * 100n + BigInt((c + "00").slice(0, 2));
  }
  const n = z.number().finite().nonnegative().parse(priceUsd);
  return BigInt(Math.round(n * 100));
}

/** Integer-cents value of a minor-unit balance. Truncates sub-cent dust. */
export function assetValueCents(balanceMinor: string, decimals: number, priceUsd: number | string): bigint {
  const amount = BigInt(z.string().regex(/^-?\d+$/).parse(balanceMinor));
  const dec = z.number().int().min(0).max(36).parse(decimals);
  const cents = priceToCents(priceUsd);
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  const total = (abs * cents) / 10n ** BigInt(dec);
  return neg ? -total : total;
}

/** Render integer cents as a fixed 2-decimal string ("12.34", "-0.01"). */
export function formatCents(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const dollars = abs / 100n;
  const rest = (abs % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${dollars.toString()}.${rest}`;
}

export function buildPortfolioModel(assets: PortfolioAsset[], nowIso?: string): PortfolioModel {
  const list = z.array(AssetSchema).parse(assets);
  let totalCents = 0n;
  const rows = list.map((a) => {
    const value = assetValueCents(a.balanceMinor, a.decimals, a.priceUsd);
    totalCents += value;
    return {
      chain: a.chain,
      symbol: a.symbol,
      balance: formatBalance(a.balanceMinor, a.decimals),
      valueUsd: formatCents(value),
    };
  });
  return {
    totalUsd: formatCents(totalCents),
    rows,
    updatedAt: nowIso ?? new Date().toISOString(),
  };
}
