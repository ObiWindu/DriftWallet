// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

/**
 * Send-flow recipient resolution pipeline.
 *
 * Input is a raw user string: an address OR a human name (ENS `.eth`, SNS
 * `.sol`, ADA handle `$name`). Resolution goes through an injected resolver
 * (never direct network in this module), then address validation, then the
 * address-poison check against known history. Output is a review model the
 * send screen renders before any signing happens.
 */

export type SendNameKind = "ens" | "sns" | "ada-handle";

export type ResolveNameFn = (name: string, kind: SendNameKind) => Promise<string | null>;
export type ValidateAddressFn = (chainId: string, address: string) => boolean;

export interface SendDeps {
  resolveName: ResolveNameFn;
  validateAddress: ValidateAddressFn;
  /** Known/used addresses for the poison check (history). */
  knownHistory?: string[];
}

export const RecipientResolutionSchema = z.object({
  ok: z.literal(true),
  address: z.string().min(1),
  source: z.enum(["address", "ens", "sns", "ada-handle"]),
  resolvedName: z.string().optional(),
  warnings: z.array(z.string()),
});
export type RecipientResolution = z.infer<typeof RecipientResolutionSchema>;

export const RecipientErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
  code: z.enum(["unresolved-name", "invalid-address", "bad-input"]),
});
export type RecipientError = z.infer<typeof RecipientErrorSchema>;

export type ResolveRecipientResult = RecipientResolution | RecipientError;

// ---------------------------------------------------------------- detection

const ENS_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/i;
const SNS_RE = /^[a-z0-9-]+\.sol$/i;
const ADA_HANDLE_RE = /^\$[a-z0-9-_]{1,64}$/i;

/** Detect whether the raw input is a human name rather than an address. */
export function detectNameKind(input: string): SendNameKind | null {
  const s = z.string().min(1).max(128).parse(input.trim());
  if (ENS_RE.test(s)) return "ens";
  if (SNS_RE.test(s)) return "sns";
  if (ADA_HANDLE_RE.test(s)) return "ada-handle";
  return null;
}

// ---------------------------------------------------------------- poison

function affixes(addr: string): { first4: string; last4: string } | null {
  const norm = addr.toLowerCase().replace(/^0x/, "");
  if (norm.length < 8) return null;
  return { first4: norm.slice(0, 4), last4: norm.slice(-4) };
}

/** first4/last4 collision against known history -> warning (mirrors policy-engine). */
export function poisonWarning(history: string[], dest: string): string | null {
  const d = affixes(dest);
  if (!d) return null;
  const seen = history.some((h) => h.toLowerCase() === dest.toLowerCase());
  if (seen) return null;
  for (const h of history) {
    const a = affixes(h);
    if (a && a.first4 === d.first4 && a.last4 === d.last4) {
      return "destination mimics a known address (first4/last4 collision) — verify the full address";
    }
  }
  if (history.length > 0) {
    return "unseen address — not in your address book; verify before sending";
  }
  return null;
}

// ---------------------------------------------------------------- pipeline

/**
 * Resolve a recipient string for a chain.
 *  1. name? -> injected resolver -> address
 *  2. validate address for the chain
 *  3. poison check vs known history -> warnings (never blocks here; the
 *     policy engine owns the verdict at approval time)
 */
export async function resolveRecipient(
  chainId: string,
  rawInput: string,
  deps: SendDeps,
): Promise<ResolveRecipientResult> {
  z.string().min(1).parse(chainId);
  const input = z.string().min(1).max(256).parse(rawInput.trim());
  if (typeof deps.resolveName !== "function" || typeof deps.validateAddress !== "function") {
    throw new Error("deps must provide resolveName + validateAddress");
  }
  const history = z.array(z.string()).parse(deps.knownHistory ?? []);

  let address: string;
  let source: RecipientResolution["source"] = "address";
  let resolvedName: string | undefined;

  const kind = detectNameKind(input);
  if (kind !== null) {
    const resolved = await deps.resolveName(input, kind);
    if (resolved === null || resolved === "") {
      return RecipientErrorSchema.parse({ ok: false, error: `could not resolve ${input}`, code: "unresolved-name" });
    }
    address = resolved;
    source = kind;
    resolvedName = input;
  } else {
    address = input;
  }

  if (!deps.validateAddress(chainId, address)) {
    return RecipientErrorSchema.parse({
      ok: false,
      error: `invalid address for ${chainId}: ${address.slice(0, 12)}…`,
      code: "invalid-address",
    });
  }

  const warnings: string[] = [];
  const poison = poisonWarning(history, address);
  if (poison) warnings.push(poison);
  if (source !== "address") warnings.push(`resolved ${resolvedName} via ${source} — confirm the address shown`);

  return RecipientResolutionSchema.parse({
    ok: true,
    address,
    source,
    ...(resolvedName !== undefined ? { resolvedName } : {}),
    warnings,
  });
}

// ---------------------------------------------------------------- amount guard

/**
 * Guard rail before building a send intent: amount must be a positive
 * bigint base-unit string and must not exceed the balance. Returns the
 * amount or a typed error the UI renders inline.
 */
export function checkSendAmount(
  amountBaseUnits: string,
  balanceBaseUnits: string,
): { ok: true; amount: bigint } | { ok: false; error: string } {
  const UintStr = z.string().regex(/^\d+$/);
  let amt: bigint;
  let bal: bigint;
  try {
    amt = BigInt(UintStr.parse(amountBaseUnits));
    bal = BigInt(UintStr.parse(balanceBaseUnits));
  } catch {
    return { ok: false, error: "amount must be a non-negative integer (base units)" };
  }
  if (amt <= 0n) return { ok: false, error: "amount must be greater than zero" };
  if (amt > bal) return { ok: false, error: "amount exceeds balance" };
  return { ok: true, amount: amt };
}
