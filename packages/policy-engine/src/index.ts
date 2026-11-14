// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

export const IntentSchema = z.object({
  chainId: z.string(),
  kind: z.enum(["native-transfer", "token-transfer", "dapp-sign"]),
  from: z.string(),
  to: z.string(),
  amountBaseUnits: z.string().regex(/^\d+$/),
  feeBaseUnits: z.string().regex(/^\d+$/),
  dataHex: z.string().optional(),
  origin: z.string(),
});
export type Intent = z.infer<typeof IntentSchema>;

export interface Finding { severity: "info" | "warn" | "block"; code: string; message: string }
export interface Verdict { verdict: "allow" | "warn" | "block"; findings: Finding[] }

const PHISH = ["evil-drain.example", "wallet-verify-seed.example", "airdrop-claim-free.example"];

/**
 * Phishing check against the built-in list PLUS an injected dynamic list
 * (gateway /v1/phishlist). Unparsable origin always blocks.
 */
export function isPhishingDomain(origin: string, extraDomains: string[] = []): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    const all = [...PHISH, ...z.array(z.string()).parse(extraDomains).map((d) => d.toLowerCase())];
    if (all.some((d) => host === d || host.endsWith(`.${d}`))) return true;
    // homograph-ish: punycode xn-- or excessive hyphens mimicking brands
    if (host.startsWith("xn--")) return true;
    return false;
  } catch {
    return true; // unparsable origin = block
  }
}

const MAX_UINT256 = (1n << 256n) - 1n;

// ---- Address-poison check ----
function affixes(addr: string): { first4: string; last4: string } | null {
  const norm = addr.toLowerCase().replace(/^0x/, "");
  if (norm.length < 8) return null;
  return { first4: norm.slice(0, 4), last4: norm.slice(-4) };
}

export function checkAddressPoison(history: string[], to: string): Finding | null {
  const list = z.array(z.string()).parse(history);
  const dest = z.string().parse(to);
  const dAff = affixes(dest);
  if (!dAff) return null;
  const seen = list.some((h) => h.toLowerCase() === dest.toLowerCase());
  if (seen) return null; // sending to a known address is fine
  for (const h of list) {
    const hAff = affixes(h);
    if (!hAff) continue;
    if (hAff.first4 === dAff.first4 && hAff.last4 === dAff.last4) {
      return {
        severity: "warn",
        code: "ADDRESS_POISON",
        message: "destination mimics a known address (first4/last4 collision) with an unseen address — verify full address",
      };
    }
  }
  return null;
}

// ---- Fee sanity ----
export function checkFeeSanity(
  amountBaseUnits: string,
  feeBaseUnits: string,
  fiatUsd?: { feeUsd?: number },
): Finding | null {
  const amount = BigInt(z.string().regex(/^\d+$/).parse(amountBaseUnits));
  const fee = BigInt(z.string().regex(/^\d+$/).parse(feeBaseUnits));
  const feeUsd = fiatUsd?.feeUsd;
  if (feeUsd !== undefined) z.number().nonnegative().parse(feeUsd);
  if (amount > 0n && fee * 100n > amount * 5n) {
    return { severity: "warn", code: "HIGH_FEE", message: `fee ${fee} > 5% of amount — require second confirm` };
  }
  if (feeUsd !== undefined && feeUsd > 50) {
    return { severity: "warn", code: "HIGH_FEE_FIAT", message: `fee $${feeUsd} exceeds $50 — require second confirm` };
  }
  return null;
}

// ---- Simulation stubs ----
export const BalanceDiffSchema = z.object({
  address: z.string(),
  token: z.string(),
  before: z.string().regex(/^\d+$/),
  after: z.string().regex(/^\d+$/),
  delta: z.string().regex(/^-?\d+$/),
});
export type BalanceDiff = z.infer<typeof BalanceDiffSchema>;

// Real simulation happens in apps via gateway; these stubs return the
// expected shape so the engine comparison logic is testable offline.
export async function simulateEvm(intent: Intent): Promise<BalanceDiff[]> {
  IntentSchema.parse(intent);
  const amount = BigInt(intent.amountBaseUnits);
  const fee = BigInt(intent.feeBaseUnits);
  const total = amount + fee;
  return [{ address: intent.from, token: "native", before: total.toString(), after: "0", delta: `-${total}` }];
}

export async function simulateSolana(intent: Intent): Promise<BalanceDiff[]> {
  IntentSchema.parse(intent);
  const amount = BigInt(intent.amountBaseUnits);
  const fee = BigInt(intent.feeBaseUnits);
  const total = amount + fee;
  return [{ address: intent.from, token: "SOL", before: total.toString(), after: "0", delta: `-${total}` }];
}

export function compareSimulation(
  claimed: BalanceDiff[],
  simulated: BalanceDiff[],
  tolerance: bigint = 0n,
): Finding | null {
  const c = z.array(BalanceDiffSchema).parse(claimed);
  const s = z.array(BalanceDiffSchema).parse(simulated);
  if (typeof tolerance !== "bigint" || tolerance < 0n) {
    throw new Error("tolerance must be a non-negative bigint");
  }
  if (c.length !== s.length) {
    return { severity: "block", code: "SIM_MISMATCH", message: "claimed balance diffs do not match simulation" };
  }
  // Dust tolerance: numeric before/after/delta fields may differ by <= tolerance
  // (caller passes a small allowance for fee-asset rounding; default 0n = exact
  // for non-fee assets). Address match stays case-insensitive, token exact.
  const within = (x: string, y: string): boolean => {
    const diff = BigInt(x) >= BigInt(y) ? BigInt(x) - BigInt(y) : BigInt(y) - BigInt(x);
    return diff <= tolerance;
  };
  for (let i = 0; i < c.length; i++) {
    const a = c[i] as BalanceDiff;
    const b = s[i] as BalanceDiff;
    if (a.address.toLowerCase() !== b.address.toLowerCase() || a.token !== b.token) {
      return { severity: "block", code: "SIM_MISMATCH", message: "claimed balance diffs do not match simulation" };
    }
    if (!within(a.before, b.before) || !within(a.after, b.after) || !within(a.delta, b.delta)) {
      return { severity: "block", code: "SIM_MISMATCH", message: "claimed balance diffs do not match simulation" };
    }
  }
  return null;
}

// ---- Iteration 3: spending limits, EIP-712 domain match, extra selectors ----

/**
 * Per-session spending-limit check. `spent` + `amount` must stay <= limit.
 * Returns a block finding when the tx would exceed the limit, a warn finding
 * when it lands within the last 20% of the budget.
 */
export function checkSpendingLimit(
  spentBaseUnits: string,
  amountBaseUnits: string,
  limitBaseUnits: string,
): Finding | null {
  const UintStr = z.string().regex(/^\d+$/);
  const spent = BigInt(UintStr.parse(spentBaseUnits));
  const amount = BigInt(UintStr.parse(amountBaseUnits));
  const limit = BigInt(UintStr.parse(limitBaseUnits));
  if (limit <= 0n) return null; // no limit configured
  if (spent + amount > limit) {
    return {
      severity: "block",
      code: "SPEND_LIMIT_EXCEEDED",
      message: `session spend ${spent + amount} would exceed limit ${limit} base units`,
    };
  }
  if (spent + amount >= (limit * 80n) / 100n) {
    return {
      severity: "warn",
      code: "SPEND_LIMIT_NEAR",
      message: `session spend is at >=80% of the ${limit} base-unit limit`,
    };
  }
  return null;
}

export interface TypedDataDomain {
  name?: string | undefined;
  version?: string | undefined;
  chainId?: number | undefined;
  verifyingContract?: string | undefined;
}

/**
 * EIP-712 domain sanity: when the typed data names a project, the origin host
 * should plausibly match it (normalized). Mismatch -> warn (not block: some
 * legit contracts sign with a different brand name). A verifyingContract on
 * the phish list -> block via the normal origin check.
 */
export function checkEip712Domain(domain: TypedDataDomain, origin: string): Finding | null {
  z.object({
    name: z.string().optional(),
    version: z.string().optional(),
    chainId: z.number().optional(),
    verifyingContract: z.string().optional(),
  }).parse(domain);
  const host = (() => {
    try {
      return new URL(origin).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  const name = (domain.name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (name.length >= 3 && host.length > 0 && !host.includes(name)) {
    return {
      severity: "warn",
      code: "EIP712_DOMAIN_MISMATCH",
      message: `typed-data domain "${domain.name}" does not match origin host — possible phishing signature`,
    };
  }
  return null;
}

// keccak selectors for dangerous approval methods
const SELECTOR_SET_APPROVAL_FOR_ALL = "0xa22cb465"; // setApprovalForAll(address,bool)
const SELECTOR_PERMIT = "0xd505accf"; // permit(address,address,uint256,uint8,bytes32,bytes32)

/** Extra dangerous-selector scan beyond ERC-20 approve. */
export function checkDangerousSelector(dataHex: string | undefined): Finding | null {
  if (!dataHex) return null;
  const d = dataHex.toLowerCase();
  if (d.startsWith(SELECTOR_SET_APPROVAL_FOR_ALL)) {
    const approved = d.slice(-64);
    if (approved === (1n).toString(16).padStart(64, "0")) {
      return {
        severity: "warn",
        code: "NFT_APPROVAL_ALL",
        message: "setApprovalForAll(true) grants an operator control of ALL your NFTs — prefer per-token approval",
      };
    }
  }
  if (d.startsWith(SELECTOR_PERMIT)) {
    // permit value is the 3rd 32-byte word
    const valueWord = d.slice(2 + 8 + 64 * 2, 2 + 8 + 64 * 3);
    if (valueWord === MAX_UINT256.toString(16).padStart(64, "0")) {
      return {
        severity: "warn",
        code: "PERMIT_INFINITE",
        message: "permit with max value — unlimited token spend for the spender",
      };
    }
  }
  return null;
}

export interface EvaluateCtx {
  history?: string[];
  feeFiatUsd?: number;
  claimed?: BalanceDiff[];
  simulated?: BalanceDiff[] | null;
  tolerance?: bigint;
  /** Iteration 3 additions (all optional; absence preserves old verdicts). */
  phishDomains?: string[];
  spentBaseUnits?: string;
  spendLimitBaseUnits?: string;
  typedDataDomain?: TypedDataDomain;
}

export async function evaluate(intent: Intent, ctx: EvaluateCtx = {}): Promise<Verdict> {
  const findings: Finding[] = [];
  if (isPhishingDomain(intent.origin, ctx.phishDomains ?? [])) {
    findings.push({ severity: "block", code: "PHISH_DOMAIN", message: `blocked phishing origin ${intent.origin}` });
    return { verdict: "block", findings };
  }
  // opaque eth_sign
  if (intent.kind === "dapp-sign" && (!intent.dataHex || intent.dataHex === "0x")) {
    findings.push({ severity: "block", code: "OPAQUE_SIGN", message: "opaque personal_sign blocked; use typed-data" });
    return { verdict: "block", findings };
  }
  // infinite allowance heuristic: ERC20 approve data with max uint
  if (intent.dataHex?.toLowerCase().startsWith("0x095ea7b3")) {
    const amtHex = intent.dataHex.slice(-64);
    if (amtHex.toLowerCase() === MAX_UINT256.toString(16).padStart(64, "0")) {
      findings.push({ severity: "warn", code: "INFINITE_ALLOWANCE", message: "infinite approval — suggest exact amount" });
    }
  }
  // iteration 3: other dangerous selectors (setApprovalForAll, permit)
  const selFinding = checkDangerousSelector(intent.dataHex);
  if (selFinding) findings.push(selFinding);
  // iteration 3: EIP-712 domain vs origin
  if (ctx.typedDataDomain) {
    const domFinding = checkEip712Domain(ctx.typedDataDomain, intent.origin);
    if (domFinding) findings.push(domFinding);
  }
  // iteration 3: per-session spending limit
  if (ctx.spendLimitBaseUnits !== undefined && ctx.spentBaseUnits !== undefined) {
    const limitFinding = checkSpendingLimit(ctx.spentBaseUnits, intent.amountBaseUnits, ctx.spendLimitBaseUnits);
    if (limitFinding) {
      findings.push(limitFinding);
      if (limitFinding.severity === "block") return { verdict: "block", findings };
    }
  }
  // address-poison (only when history supplied; preserves old verdicts otherwise)
  if (ctx.history) {
    const f = checkAddressPoison(ctx.history, intent.to);
    if (f) findings.push(f);
  }
  // fee sanity: fee > 5% of amount (when amount > 0) or fiat > $50
  const feeFinding = checkFeeSanity(
    intent.amountBaseUnits,
    intent.feeBaseUnits,
    ctx.feeFiatUsd === undefined ? undefined : { feeUsd: ctx.feeFiatUsd },
  );
  if (feeFinding) {
    if (!findings.some((f) => f.code === feeFinding.code)) findings.push(feeFinding);
  }
  // simulation comparison: block on mismatch beyond dust tolerance.
  // simulated === null means stub mode (gateway returned diff:null): emit
  // info SIM_UNAVAILABLE and never block on a missing simulation.
  // When both claimed + simulated are supplied: mismatch -> block SIM_MISMATCH,
  // match -> info SIM_OK. When no simulation is supplied at all (both undefined
  // or claimed without simulated), verdicts are unchanged from before.
  const tolerance = ctx.tolerance ?? 0n;
  if (ctx.simulated === null) {
    findings.push({
      severity: "info",
      code: "SIM_UNAVAILABLE",
      message: "simulation unavailable (stub mode) — approval proceeds without sim check",
    });
  } else if (ctx.claimed && ctx.simulated) {
    const f = compareSimulation(ctx.claimed, ctx.simulated, tolerance);
    if (f) {
      findings.push(f);
      return { verdict: "block", findings };
    }
    findings.push({ severity: "info", code: "SIM_OK", message: "claimed balance diffs match simulation" });
  }
  if (findings.some((f) => f.severity === "block")) return { verdict: "block", findings };
  if (findings.some((f) => f.severity === "warn")) return { verdict: "warn", findings };
  findings.push({ severity: "info", code: "OK", message: "checks passed" });
  return { verdict: "allow", findings };
}
