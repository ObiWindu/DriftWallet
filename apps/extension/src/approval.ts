// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// Approval queue (T010). Pure TS model for the popup approval screen.
// Background SW owns the authoritative queue; this module is the shared
// logic + display model so popup and tests stay in sync.
// Policy-engine verdicts are display-only here: background must re-check
// the verdict before dispatching to the offscreen signer.

import { z } from "zod";

export const PolicyVerdict = z.enum(["allow", "deny", "stepUp"]);
export type PolicyVerdict = z.infer<typeof PolicyVerdict>;

export const ApprovalRequest = z.object({
  id: z.string().min(1),
  origin: z.string().url(),
  method: z.string().min(1),
  paramsSummary: z.string(),
  verdict: PolicyVerdict,
  verdictReason: z.string(),
  receivedAt: z.number(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;

export const ApprovalDecision = z.enum(["approved", "rejected", "pending"]);
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

export interface ApprovalEntry extends ApprovalRequest {
  decision: ApprovalDecision;
}

export function requestApproval(queue: ApprovalEntry[], req: ApprovalRequest): ApprovalEntry[] {
  if (queue.some((e) => e.id === req.id)) throw new Error(`duplicate approval id: ${req.id}`);
  return [...queue, { ...req, decision: "pending" }];
}

export function pendingApprovals(queue: ApprovalEntry[]): ApprovalEntry[] {
  return queue.filter((e) => e.decision === "pending");
}

function setDecision(queue: ApprovalEntry[], id: string, decision: ApprovalDecision): ApprovalEntry[] {
  let found = false;
  const next = queue.map((e) => {
    if (e.id !== id) return e;
    found = true;
    if (e.decision !== "pending") throw new Error(`already decided: ${id}`);
    return { ...e, decision };
  });
  if (!found) throw new Error(`unknown approval id: ${id}`);
  return next;
}

export function approve(queue: ApprovalEntry[], id: string): ApprovalEntry[] {
  return setDecision(queue, id, "approved");
}

export function reject(queue: ApprovalEntry[], id: string): ApprovalEntry[] {
  return setDecision(queue, id, "rejected");
}

/** Display model: what the popup shows before the user confirms. */
export function verdictDisplay(v: PolicyVerdict): { badge: string; tone: "ok" | "bad" | "warn" } {
  switch (v) {
    case "allow":
      return { badge: "Policy: allow", tone: "ok" };
    case "deny":
      return { badge: "Policy: deny — do not sign", tone: "bad" };
    case "stepUp":
      return { badge: "Policy: step-up auth required", tone: "warn" };
  }
}

// ---------------------------------------------------------------------------
// U021: human-readable approval screen models. Display-only — the background
// SW re-checks policy-engine verdicts before dispatching to the offscreen
// signer. All money stays bigint; all bridge/dApp input is zod-validated.
// ---------------------------------------------------------------------------

const Hex0x = z.string().regex(/^0x[0-9a-fA-F]*$/);
const UintStr = z.string().regex(/^\d+$/);

/** Decoded-call display model producers (transfer / approve / stake). */
export const DecodedCall = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("transfer"),
    token: z.string().min(1),
    to: z.string().min(1),
    amountMinor: UintStr,
    decimals: z.number().int().min(0).max(36),
    title: z.string(),
  }),
  z.object({
    kind: z.literal("approve"),
    token: z.string().min(1),
    spender: z.string().min(1),
    amountMinor: UintStr,
    decimals: z.number().int().min(0).max(36),
    unlimited: z.boolean(),
    title: z.string(),
  }),
  z.object({
    kind: z.literal("stake"),
    pool: z.string().min(1),
    amountMinor: UintStr,
    decimals: z.number().int().min(0).max(36),
    action: z.enum(["delegate", "undelegate", "withdraw"]),
    title: z.string(),
  }),
  z.object({
    kind: z.literal("unknown"),
    method: z.string().min(1),
    dataHex: z.string(),
    title: z.string(),
  }),
]);
export type DecodedCall = z.infer<typeof DecodedCall>;

const TRANSFER_SEL = "0xa9059cbb";
const APPROVE_SEL = "0x095ea7b3";

function padTopic(word: string): string {
  return `0x${word.slice(-64).padStart(64, "0")}`;
}

function topicToAddress(topic: string): string {
  return `0x${topic.slice(-40)}`;
}

/** Producer: native/token transfer display row. */
export function decodedTransfer(token: string, to: string, amountMinor: string, decimals: number): DecodedCall {
  return DecodedCall.parse({
    kind: "transfer",
    token: z.string().min(1).parse(token),
    to: z.string().min(1).parse(to),
    amountMinor: UintStr.parse(amountMinor),
    decimals: z.number().int().min(0).max(36).parse(decimals),
    title: `Send to ${to}`,
  });
}

/** Producer: ERC-20 approve display row (flags infinite allowances). */
export function decodedApprove(
  token: string,
  spender: string,
  amountMinor: string,
  decimals: number,
): DecodedCall {
  const amt = UintStr.parse(amountMinor);
  return DecodedCall.parse({
    kind: "approve",
    token: z.string().min(1).parse(token),
    spender: z.string().min(1).parse(spender),
    amountMinor: amt,
    decimals: z.number().int().min(0).max(36).parse(decimals),
    unlimited: BigInt(amt) === (1n << 256n) - 1n,
    title: `Approve ${spender}`,
  });
}

/** Producer: staking intent display row. */
export function decodedStake(
  pool: string,
  amountMinor: string,
  decimals: number,
  action: "delegate" | "undelegate" | "withdraw",
): DecodedCall {
  return DecodedCall.parse({
    kind: "stake",
    pool: z.string().min(1).parse(pool),
    amountMinor: UintStr.parse(amountMinor),
    decimals: z.number().int().min(0).max(36).parse(decimals),
    action: z.enum(["delegate", "undelegate", "withdraw"]).parse(action),
    title: `${action} stake`,
  });
}

/**
 * Best-effort ERC-20 calldata decoder for the approval screen.
 * Unknown selectors / malformed data fall back to `{ kind: "unknown" }`
 * (never throws on dApp-supplied bytes — the screen must always render).
 */
export function decodeEvmCalldata(raw: unknown, token = "unknown-token"): DecodedCall {
  const parsed = z.object({ dataHex: Hex0x, decimals: z.number().int().min(0).max(36).optional() }).safeParse(raw);
  if (!parsed.success) return { kind: "unknown", method: "invalid", dataHex: "0x", title: "Unrecognized call" };
  const { dataHex, decimals = 18 } = parsed.data;
  const hex = dataHex.toLowerCase();
  try {
    if (hex.startsWith(TRANSFER_SEL) && hex.length === 2 + 8 + 64 + 64) {
      const to = topicToAddress(padTopic(hex.slice(10, 74)));
      const amount = BigInt(`0x${hex.slice(74, 138)}`).toString();
      return decodedTransfer(token, to, amount, decimals);
    }
    if (hex.startsWith(APPROVE_SEL) && hex.length === 2 + 8 + 64 + 64) {
      const spender = topicToAddress(padTopic(hex.slice(10, 74)));
      const amount = BigInt(`0x${hex.slice(74, 138)}`).toString();
      return decodedApprove(token, spender, amount, decimals);
    }
  } catch {
    // fall through to unknown
  }
  return { kind: "unknown", method: hex.slice(0, 10), dataHex, title: "Unrecognized call — review carefully" };
}

// ---- Simulation-diff display model ----

export const BalanceDiff = z.object({
  address: z.string().min(1),
  token: z.string().min(1),
  before: UintStr,
  after: UintStr,
  delta: z.string().regex(/^-?\d+$/),
});
export type BalanceDiff = z.infer<typeof BalanceDiff>;

export interface SimDiffRow {
  address: string;
  token: string;
  before: string;
  after: string;
  delta: string;
  direction: "in" | "out" | "none";
}

/**
 * Extension-local simulation-diff display rows (mirrors the policy-engine
 * `BalanceDiff` shape; the engine package stays read-only).
 * `formatAmount` renders minor units — pass the bigint-aware formatter.
 */
export function simDiffDisplay(
  raw: unknown,
  formatAmount: (minor: string, token: string) => string,
): SimDiffRow[] {
  const diffs = z.array(BalanceDiff).parse(raw);
  return diffs.map((d) => {
    const delta = BigInt(d.delta);
    return {
      address: d.address,
      token: d.token,
      before: formatAmount(d.before, d.token),
      after: formatAmount(d.after, d.token),
      delta: `${delta < 0n ? "-" : delta > 0n ? "+" : ""}${formatAmount((delta < 0n ? -delta : delta).toString(), d.token)}`,
      direction: delta < 0n ? "out" : delta > 0n ? "in" : "none",
    };
  });
}

/** Display-level sim comparison (engine `compareSimulation` still enforces). */
export function simMatchesClaimed(claimed: unknown, simulated: unknown): boolean {
  const c = z.array(BalanceDiff).safeParse(claimed);
  const s = z.array(BalanceDiff).safeParse(simulated);
  if (!c.success || !s.success || c.data.length !== s.data.length) return false;
  return c.data.every(
    (a, i) => {
      const b = s.data[i] as BalanceDiff;
      return (
        a.address.toLowerCase() === b.address.toLowerCase() &&
        a.token === b.token &&
        a.delta === b.delta &&
        a.after === b.after &&
        a.before === b.before
      );
    },
  );
}

// ---- Per-origin settings ("always ask" / auto-reject list) ----

export const OriginSetting = z.enum(["always-ask", "auto-reject"]);
export type OriginSetting = z.infer<typeof OriginSetting>;

export type OriginPolicyMap = Record<string, OriginSetting>;

const OriginMapSchema = z.record(z.string().url(), OriginSetting);

export function getOriginPolicy(map: unknown, origin: string): OriginSetting {
  const m = OriginMapSchema.parse(map);
  const o = z.string().url().parse(origin);
  return m[o] ?? "always-ask";
}

export function setOriginPolicy(map: unknown, origin: string, setting: OriginSetting): OriginPolicyMap {
  const m = OriginMapSchema.parse(map);
  const o = z.string().url().parse(origin);
  const s = OriginSetting.parse(setting);
  return { ...m, [o]: s };
}

/** Auto-reject list check: unknown origins default to "always ask" (never auto-approve). */
export function shouldAutoReject(map: unknown, origin: string): boolean {
  return getOriginPolicy(map, origin) === "auto-reject";
}

// ---- WebAuthn-gated approve stub (interface + memory impl, no credentials) ----

/**
 * Platform WebAuthn gate. Production shells implement this with
 * `navigator.credentials`; this module ships only the interface plus an
 * in-memory stub for tests and non-WebAuthn contexts. No credential bytes
 * ever flow through here — just an allow/deny assertion handle.
 */
export interface WebAuthnGate {
  isAvailable(): Promise<boolean>;
  /** Resolve when the user completes the platform assertion; reject on cancel. */
  assert(reason: string): Promise<{ ok: true; credentialId: string }>;
}

/** In-memory stub: deterministic, no real credential code. */
export class MemoryWebAuthnGate implements WebAuthnGate {
  private available: boolean;
  private approveAll: boolean;

  constructor(opts?: { available?: boolean; approveAll?: boolean }) {
    this.available = opts?.available ?? true;
    this.approveAll = opts?.approveAll ?? true;
  }

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async assert(reason: string): Promise<{ ok: true; credentialId: string }> {
    if (reason.length === 0) throw new Error("missing reason");
    if (!this.available) throw new Error("webauthn unavailable");
    if (!this.approveAll) throw new Error("user cancelled webauthn assertion");
    return { ok: true, credentialId: "memory-stub-credential" };
  }
}

export interface GatedApproveResult {
  queue: ApprovalEntry[];
  credentialId: string | null;
}

/**
 * Approve with an optional WebAuthn gate. Gating is required when
 * `requireGate` is set or the entry verdict is `stepUp`; `deny` verdicts
 * always throw (the screen must not offer approve). Returns the new queue —
 * callers persist it in the background SW.
 */
export async function approveWithGate(
  queue: ApprovalEntry[],
  id: string,
  gate: WebAuthnGate,
  opts?: { requireGate?: boolean },
): Promise<GatedApproveResult> {
  const entry = queue.find((e) => e.id === z.string().min(1).parse(id));
  if (!entry) throw new Error(`unknown approval id: ${id}`);
  if (entry.decision !== "pending") throw new Error(`already decided: ${id}`);
  if (entry.verdict === "deny") throw new Error(`policy deny — cannot approve: ${id}`);
  const needsGate = (opts?.requireGate ?? false) || entry.verdict === "stepUp";
  let credentialId: string | null = null;
  if (needsGate) {
    if (!(await gate.isAvailable())) throw new Error("webauthn unavailable for step-up");
    const res = await gate.assert(`approve ${entry.method} for ${entry.origin}`);
    credentialId = res.credentialId;
  }
  return { queue: approve(queue, id), credentialId };
}
