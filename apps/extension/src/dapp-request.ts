// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// Iteration 4 — dApp request pipeline (EIP-1193 / WC / CIP-30 ingress).
// Turns an untrusted dApp JSON-RPC request into a policy-engine Intent, runs
// `decideWithPolicy` (phishing, poison, limits, simulation, domain match) and
// enqueues an ApprovalEntry. THIS MODULE NEVER SIGNS — the offscreen signer is
// only reachable after a user decision on a non-deny entry.

import { z } from "zod";
import {
  decideWithPolicy,
  requestApproval,
  typedDataDomainOf,
  type ApprovalEntry,
  type ApprovalRequest,
  type PolicyVerdict,
} from "./approval.js";
import type { BalanceDiff, Intent } from "@drift/policy-engine";

export const DappMethod = z.enum([
  "eth_requestAccounts",
  "eth_sendTransaction",
  "personal_sign",
  "eth_sign",
  "eth_signTypedData_v4",
  "wallet_switchEthereumChain",
  "solana_signTransaction",
  "cardano_signTx",
]);
export type DappMethod = z.infer<typeof DappMethod>;

export const DappRequest = z.object({
  id: z.union([z.string().min(1), z.number().int()]),
  origin: z.string().url(),
  method: DappMethod,
  params: z.unknown().optional(),
  chainId: z.string().min(1).default("eip155:1"),
});
export type DappRequest = z.infer<typeof DappRequest>;

/** Methods allowed per namespace; everything else is rejected up front. */
export const EIP155_METHODS: ReadonlySet<string> = new Set([
  "eth_requestAccounts",
  "eth_sendTransaction",
  "personal_sign",
  "eth_signTypedData_v4",
  "wallet_switchEthereumChain",
]);

export interface SimResult {
  stub: boolean;
  diff: { balanceChanges: { address: string; asset: string; before: string; after: string }[] } | null;
}

export interface DappDeps {
  phishDomains?: string[];
  spentBaseUnits?: string;
  spendLimitBaseUnits?: string;
  /** Gateway simulation for eth_sendTransaction (EVM). */
  simulateEvm?: (input: { chainId: string; from: string; to: string; dataHex?: string; valueWei?: string }) => Promise<SimResult>;
  /** Fee estimate in wei for the tx (used as the sim delta tolerance). */
  feeBaseUnits?: string;
  nowMs?: number;
}

const Hex0x = z.string().regex(/^0x[0-9a-fA-F]*$/);

function hexToDec(v: unknown): string {
  if (typeof v !== "string") return "0";
  if (!/^0x[0-9a-fA-F]+$/.test(v)) return "0";
  return BigInt(v).toString();
}

/** Build the policy Intent for a dApp request. Throws on malformed params. */
export function intentFromRequest(req: DappRequest): { intent: Intent; typedDataDomain?: ReturnType<typeof typedDataDomainOf> } {
  const r = DappRequest.parse(req);
  switch (r.method) {
    case "eth_requestAccounts":
    case "wallet_switchEthereumChain":
      return {
        intent: {
          chainId: r.chainId,
          kind: "dapp-sign",
          from: "0x0",
          to: "0x0",
          amountBaseUnits: "0",
          feeBaseUnits: "0",
          origin: r.origin,
        },
      };
    case "personal_sign":
    case "eth_sign": {
      const params = z.array(z.unknown()).parse(r.params ?? []);
      const data = params[0];
      const dataHex = typeof data === "string" && Hex0x.safeParse(data).success ? data : "0x";
      return {
        intent: {
          chainId: r.chainId,
          kind: "dapp-sign",
          from: "0x0",
          to: "0x0",
          amountBaseUnits: "0",
          feeBaseUnits: "0",
          dataHex,
          origin: r.origin,
        },
      };
    }
    case "eth_signTypedData_v4": {
      return {
        intent: {
          chainId: r.chainId,
          kind: "dapp-sign",
          from: "0x0",
          to: "0x0",
          amountBaseUnits: "0",
          feeBaseUnits: "0",
          dataHex: "0x1234", // non-empty: typed-data, not opaque
          origin: r.origin,
        },
        typedDataDomain: typedDataDomainOf(r.params),
      };
    }
    case "eth_sendTransaction": {
      const params = z.array(z.unknown()).parse(r.params ?? []);
      const tx = z
        .object({
          from: z.string().min(1).optional(),
          to: z.string().min(1).optional(),
          value: z.unknown().optional(),
          data: z.unknown().optional(),
        })
        .passthrough()
        .parse(params[0] ?? {});
      const dataHex = typeof tx.data === "string" && Hex0x.safeParse(tx.data).success ? tx.data : "0x";
      const value = hexToDec(tx.value);
      const isTokenTransfer = dataHex.toLowerCase().startsWith("0xa9059cbb");
      return {
        intent: {
          chainId: r.chainId,
          kind: isTokenTransfer ? "token-transfer" : value !== "0" ? "native-transfer" : "dapp-sign",
          from: tx.from ?? "0x0",
          to: tx.to ?? "0x0",
          amountBaseUnits: value,
          feeBaseUnits: "0", // unknown until fee estimate; fee check runs post-estimate in background
          dataHex,
          origin: r.origin,
        },
      };
    }
    default:
      return {
        intent: {
          chainId: r.chainId,
          kind: "dapp-sign",
          from: "0x0",
          to: "0x0",
          amountBaseUnits: "0",
          feeBaseUnits: "0",
          origin: r.origin,
        },
      };
  }
}

export interface HandleResult {
  queue: ApprovalEntry[];
  entry: ApprovalEntry;
}

let approvalSeq = 0;

/**
 * Route a dApp request through policy and enqueue the approval.
 * - unknown method for the namespace -> immediate rejected entry
 * - phishing origin -> deny verdict entry (never approvable)
 * - eth_sendTransaction additionally runs gateway simulation when provided;
 *   a mismatch maps to deny (F-P0-3 enforced end-to-end).
 */
export async function handleDappRequest(
  queue: ApprovalEntry[],
  rawRequest: unknown,
  deps: DappDeps = {},
): Promise<HandleResult> {
  const req = DappRequest.parse(rawRequest);
  const now = deps.nowMs ?? Date.now();
  const isEip155 = req.chainId.startsWith("eip155:");
  if (isEip155 && !EIP155_METHODS.has(req.method)) {
    const entry: ApprovalRequest = {
      id: `dapp:${now}:${++approvalSeq}`,
      origin: req.origin,
      method: req.method,
      paramsSummary: "unsupported method",
      verdict: "deny",
      verdictReason: `method ${req.method} not allowed on ${req.chainId}`,
      receivedAt: now,
    };
    const q = requestApproval(queue, entry);
    return { queue: q.map((e) => (e.id === entry.id ? { ...e, decision: "rejected" as const } : e)), entry: { ...entry, decision: "rejected" } };
  }

  const { intent, typedDataDomain } = intentFromRequest(req);

  // simulation for value-bearing EVM txs + claimed deltas (F-P0-3 end-to-end)
  let simulated: BalanceDiff[] | null = null;
  let claimedDeltas: { address: string; token: string; delta: string }[] | undefined;
  let tolerance = 0n;
  if (req.method === "eth_sendTransaction" && deps.simulateEvm) {
    const params = z.array(z.unknown()).parse(req.params ?? []);
    const tx = (params[0] ?? {}) as { from?: string; to?: string; data?: string; value?: unknown };
    const value = hexToDec(tx.value);
    const fee = deps.feeBaseUnits !== undefined ? BigInt(z.string().regex(/^\d+$/).parse(deps.feeBaseUnits)) : 0n;
    tolerance = fee;
    const from = tx.from ?? "0x0";
    const to = tx.to ?? "0x0";
    // claimed deltas: sender loses value+fee (native), recipient gains value.
    // Token transfers: only the native fee delta is claimed (token asset
    // labels differ across simulators); the decoded call is shown instead.
    if (intent.kind === "native-transfer" && value !== "0") {
      claimedDeltas = [
        { address: from, token: "native", delta: (-(BigInt(value) + fee)).toString() },
        { address: to, token: "native", delta: value },
      ];
    } else if (fee > 0n) {
      claimedDeltas = [{ address: from, token: "native", delta: (-fee).toString() }];
    }
    const simInput: { chainId: string; from: string; to: string; dataHex?: string; valueWei?: string } = {
      chainId: req.chainId,
      from,
      to,
    };
    if (typeof tx.data === "string") simInput.dataHex = tx.data;
    if (value !== "0") simInput.valueWei = value;
    const sim = await deps.simulateEvm(simInput);
    if (!sim.stub && sim.diff) {
      simulated = sim.diff.balanceChanges.map((c) => ({
        address: c.address,
        token: c.asset,
        before: c.before,
        after: c.after,
        delta: (BigInt(c.after) - BigInt(c.before)).toString(),
      }));
    }
  }

  const ctx: NonNullable<Parameters<typeof decideWithPolicy>[0]["ctx"]> = {
    phishDomains: deps.phishDomains ?? [],
    tolerance,
  };
  if (deps.spentBaseUnits !== undefined) ctx.spentBaseUnits = deps.spentBaseUnits;
  if (deps.spendLimitBaseUnits !== undefined) ctx.spendLimitBaseUnits = deps.spendLimitBaseUnits;
  if (typedDataDomain !== undefined) ctx.typedDataDomain = typedDataDomain;
  if (simulated !== null) ctx.simulated = simulated;
  if (claimedDeltas !== undefined) ctx.claimedDeltas = claimedDeltas;
  const decision = await decideWithPolicy({ intent, ctx });

  const entry: ApprovalRequest = {
    id: `dapp:${now}:${++approvalSeq}`,
    origin: req.origin,
    method: req.method,
    paramsSummary: `${intent.kind} ${intent.amountBaseUnits} on ${req.chainId}`,
    verdict: decision.verdict as PolicyVerdict,
    verdictReason: decision.reason,
    receivedAt: now,
  };
  const next = requestApproval(queue, entry);
  const enqueued = next.find((e) => e.id === entry.id) as ApprovalEntry;
  return { queue: next, entry: enqueued };
}
