// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

/**
 * U041 — Swaps (EVM via 0x, Solana via Jupiter).
 *
 * NO live aggregator calls live in this module. Quotes arrive through an
 * injected `fetchQuote` function (the app wires it to gateway-client);
 * everything the aggregator returns is zod-validated before use.
 */

// ---------------------------------------------------------------- schemas

export const SwapParamsSchema = z.object({
  chain: z.string().min(1),
  sellToken: z.string().min(1),
  buyToken: z.string().min(1),
  /** Exact sell amount in base units (bigint decimal string — never float). */
  amountBaseUnits: z.string().regex(/^\d+$/),
  /** Slippage tolerance in basis points, 1..5000 (0.01%..50%). */
  slippageBps: z.number().int().min(1).max(5000),
  recipient: z.string().min(1),
});
export type SwapParams = z.infer<typeof SwapParamsSchema>;

export const QuoteSchema = z.object({
  sellToken: z.string().min(1),
  buyToken: z.string().min(1),
  sellAmountBaseUnits: z.string().regex(/^\d+$/),
  buyAmountBaseUnits: z.string().regex(/^\d+$/),
  /** Realized price impact in percent (decimal string, e.g. "2.5"). */
  priceImpactPct: z.string().regex(/^\d+(\.\d+)?$/),
  /** Allowance the router needs, base units. Defaults to the sell amount. */
  allowanceNeededBaseUnits: z.string().regex(/^\d+$/).optional(),
  /** Opaque route id for display/debug only (never signed blindly). */
  routeId: z.string().optional(),
});
export type Quote = z.infer<typeof QuoteSchema>;

/** Injected quote fetcher: swap params -> raw (untrusted) quote payload. */
export type FetchQuoteFn = (params: SwapParams) => Promise<unknown>;

export const PriceImpactTierSchema = z.enum(["ok", "warn", "block"]);
export type PriceImpactTier = z.infer<typeof PriceImpactTierSchema>;

export const AllowancePlanSchema = z.object({
  mode: z.enum(["exact", "infinite"]),
  amountBaseUnits: z.string().regex(/^\d+$/),
  /** Present only for infinite approvals: user-typed justification. */
  reason: z.string().optional(),
});
export type AllowancePlan = z.infer<typeof AllowancePlanSchema>;

// ---------------------------------------------------------------- builders

/** Validate + normalize raw swap input. Throws on bad input. */
export function buildSwapParams(raw: unknown): SwapParams {
  const params = SwapParamsSchema.parse(raw);
  if (params.sellToken.toLowerCase() === params.buyToken.toLowerCase()) {
    throw new Error("sellToken and buyToken must differ");
  }
  if (BigInt(params.amountBaseUnits) <= 0n) throw new Error("amount must be > 0");
  return params;
}

/**
 * Price-impact gate: ok (<3%), warn (>=3%, <10% — second confirm),
 * block (>=10% — refuse to sign).
 */
export function priceImpactTier(impactPct: number | string): PriceImpactTier {
  const n = typeof impactPct === "string" ? Number(impactPct) : impactPct;
  z.number().finite().nonnegative().parse(n);
  if (n >= 10) return "block";
  if (n >= 3) return "warn";
  return "ok";
}

/**
 * Allowance minimizer. Exact-amount approval is the default; an infinite
 * (max-uint) approval requires `allowInfinite: true` AND a non-empty
 * user-supplied reason (the type-to-confirm text the UI collects).
 */
export function allowancePlan(
  currentBaseUnits: bigint | string,
  neededBaseUnits: bigint | string,
  opts?: { allowInfinite?: boolean; reason?: string },
): AllowancePlan {
  const current = BigInt(z.string().regex(/^\d+$/).parse(String(currentBaseUnits)));
  const needed = BigInt(z.string().regex(/^\d+$/).parse(String(neededBaseUnits)));
  if (needed <= 0n) throw new Error("needed allowance must be > 0");
  if (current >= needed) {
    return AllowancePlanSchema.parse({ mode: "exact", amountBaseUnits: "0" });
  }
  if (opts?.allowInfinite === true) {
    const reason = z.string().min(1).parse((opts.reason ?? "").trim());
    return AllowancePlanSchema.parse({
      mode: "infinite",
      amountBaseUnits: ((1n << 256n) - 1n).toString(),
      reason,
    });
  }
  return AllowancePlanSchema.parse({ mode: "exact", amountBaseUnits: needed.toString() });
}

/** Fetch a quote through the injected transport and zod-validate the result. */
export async function fetchSwapQuote(params: SwapParams, fetchQuote: FetchQuoteFn): Promise<Quote> {
  SwapParamsSchema.parse(params);
  z.function().parse(fetchQuote);
  const raw = await fetchQuote(params);
  const quote = QuoteSchema.parse(raw);
  if (
    quote.sellToken.toLowerCase() !== params.sellToken.toLowerCase() ||
    quote.buyToken.toLowerCase() !== params.buyToken.toLowerCase()
  ) {
    throw new Error("quote tokens do not match request");
  }
  return quote;
}

export interface SwapReview {
  params: SwapParams;
  quote: Quote;
  impactTier: PriceImpactTier;
  allowance: AllowancePlan;
  /** Approval-screen hints. */
  warnings: string[];
}

/** Combine params + validated quote into the model the approval UI consumes. */
export function reviewSwap(
  params: SwapParams,
  quote: Quote,
  currentAllowanceBaseUnits: bigint | string,
  allowanceOpts?: { allowInfinite?: boolean; reason?: string },
): SwapReview {
  SwapParamsSchema.parse(params);
  QuoteSchema.parse(quote);
  const impactTier = priceImpactTier(quote.priceImpactPct);
  const allowance = allowancePlan(currentAllowanceBaseUnits, quote.allowanceNeededBaseUnits ?? quote.sellAmountBaseUnits, allowanceOpts);
  const warnings: string[] = [];
  if (impactTier === "warn") warnings.push(`price impact ${quote.priceImpactPct}% exceeds 3% — confirm carefully`);
  if (impactTier === "block") warnings.push(`price impact ${quote.priceImpactPct}% exceeds 10% — blocked`);
  if (allowance.mode === "infinite") warnings.push("infinite approval requested — exact amount recommended");
  return { params, quote, impactTier, allowance, warnings };
}
