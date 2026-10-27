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

export function isPhishingDomain(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    if (PHISH.some((d) => host === d || host.endsWith(`.${d}`))) return true;
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

export interface EvaluateCtx {
  history?: string[];
  feeFiatUsd?: number;
  claimed?: BalanceDiff[];
  simulated?: BalanceDiff[] | null;
  tolerance?: bigint;
}

export async function evaluate(intent: Intent, ctx: EvaluateCtx = {}): Promise<Verdict> {
  const findings: Finding[] = [];
  if (isPhishingDomain(intent.origin)) {
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
