// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import {
  allowancePlan,
  buildSwapParams,
  fetchSwapQuote,
  priceImpactTier,
  reviewSwap,
  type FetchQuoteFn,
  type SwapReview,
} from "@drift/features";
import { screenChrome, type ScreenChrome } from "../watchonly.js";

// Swap screen view-model (iteration 3). Params -> gateway quote (injected) ->
// reviewSwap with price-impact tier + allowance plan. Submit is blocked when
// impact >= 10% or when the account is watch-only.

export const SwapFormSchema = z.object({
  chain: z.string().min(1),
  sellToken: z.string().min(1),
  buyToken: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d+)?$/), // human units; converted by caller to base units
  amountBaseUnits: z.string().regex(/^\d+$/),
  slippageBps: z.number().int().min(1).max(5000),
  recipient: z.string().min(1),
});
export type SwapForm = z.infer<typeof SwapFormSchema>;

export interface SwapScreenModel {
  review: SwapReview | null;
  impactTier: "ok" | "warn" | "block";
  canSubmit: boolean;
  warnings: string[];
  chrome: ScreenChrome;
}

/** Build the swap screen model. `fetchQuote` is injected (gateway in prod). */
export async function swapScreenModel(
  rawForm: unknown,
  currentAllowanceBaseUnits: bigint | string,
  fetchQuote: FetchQuoteFn,
  opts?: { watchOnly?: boolean; allowInfinite?: boolean; reason?: string },
): Promise<SwapScreenModel> {
  const form = SwapFormSchema.parse(rawForm);
  const chrome = screenChrome(opts?.watchOnly ?? false);
  const params = buildSwapParams({
    chain: form.chain,
    sellToken: form.sellToken,
    buyToken: form.buyToken,
    amountBaseUnits: form.amountBaseUnits,
    slippageBps: form.slippageBps,
    recipient: form.recipient,
  });
  const quote = await fetchSwapQuote(params, fetchQuote);
  const allowanceOpts = opts?.allowInfinite === true
    ? { allowInfinite: true as const, ...(opts.reason !== undefined ? { reason: opts.reason } : {}) }
    : undefined;
  const review = reviewSwap(params, quote, currentAllowanceBaseUnits, allowanceOpts);
  const impactTier = priceImpactTier(quote.priceImpactPct);
  return {
    review,
    impactTier,
    canSubmit: impactTier !== "block" && chrome.canSign,
    warnings: review.warnings,
    chrome,
  };
}

/** Re-exported for settings UIs that need the allowance plan standalone. */
export function swapAllowance(current: bigint | string, needed: bigint | string, opts?: { allowInfinite?: boolean; reason?: string }) {
  return allowancePlan(current, needed, opts);
}
