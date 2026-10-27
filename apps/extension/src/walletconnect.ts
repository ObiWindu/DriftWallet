// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// U023 WalletConnect v2 session model (extension-local).
// Pure offline state machine: propose → approve/reject → session, plus a
// per-topic session-request queue. Zod-validated at every boundary.
// No network here — pairing/relay bytes flow through the injected
// `WcTransport`; this module only owns shapes + transitions.
import { z } from "zod";

export const WcProposer = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  icons: z.array(z.string().url()).max(5).default([]),
});
export type WcProposer = z.infer<typeof WcProposer>;

const Namespace = z.object({
  chains: z.array(z.string().min(1)).min(1),
  methods: z.array(z.string().min(1)).min(1),
  events: z.array(z.string().min(1)).default([]),
});

export const WcProposal = z.object({
  /** Numeric pairing proposal id (relay envelope id). */
  id: z.number().int().nonnegative(),
  pairingTopic: z.string().min(8),
  proposer: WcProposer,
  requiredNamespaces: z.record(z.string().min(1), Namespace),
  optionalNamespaces: z.record(z.string().min(1), Namespace).default({}),
  /** Unix-ms expiry of the proposal. */
  expiry: z.number().int().positive(),
});
export type WcProposal = z.infer<typeof WcProposal>;

export const WcSession = z.object({
  topic: z.string().min(8),
  peer: WcProposer,
  namespaces: z.record(z.string().min(1), Namespace),
  expiry: z.number().int().positive(),
  connectedAt: z.number().int().nonnegative(),
});
export type WcSession = z.infer<typeof WcSession>;

export const WcSessionRequest = z.object({
  topic: z.string().min(1),
  /** JSON-RPC request id from the peer. */
  id: z.number().int(),
  method: z.string().min(1),
  chainId: z.string().min(1),
  params: z.unknown(),
  receivedAt: z.number().int().nonnegative(),
});
export type WcSessionRequest = z.infer<typeof WcSessionRequest>;

export interface WcStore {
  proposals: WcProposal[];
  sessions: Record<string, WcSession>;
  requests: Record<string, WcSessionRequest[]>;
}

export function emptyWcStore(): WcStore {
  return { proposals: [], sessions: {}, requests: {} };
}

/** Transport injected by the shell (relay socket, deep-link opener, …). */
export interface WcTransport {
  send(topic: string, payload: unknown): Promise<void>;
  onMessage(cb: (topic: string, payload: unknown) => void): () => void;
}

/** Queue a pairing proposal. Duplicate ids rejected. */
export function proposeSession(store: WcStore, raw: unknown): WcStore {
  const proposal = WcProposal.parse(raw);
  if (store.proposals.some((p) => p.id === proposal.id)) {
    throw new Error(`duplicate wc proposal id: ${proposal.id}`);
  }
  return { ...store, proposals: [...store.proposals, proposal] };
}

export interface ApproveSessionInput {
  proposalId: number;
  /** Fresh session topic supplied by the transport/pairing layer. */
  topic: string;
  namespaces: Record<string, z.infer<typeof Namespace>>;
  connectedAt: number;
}

/** Approve a proposal → established session keyed by topic. */
export function approveSession(
  store: WcStore,
  raw: unknown,
): { store: WcStore; session: WcSession } {
  const input = z
    .object({
      proposalId: z.number().int().nonnegative(),
      topic: z.string().min(8),
      namespaces: z.record(z.string().min(1), Namespace),
      connectedAt: z.number().int().nonnegative(),
    })
    .parse(raw);
  const proposal = store.proposals.find((p) => p.id === input.proposalId);
  if (!proposal) throw new Error(`unknown wc proposal: ${input.proposalId}`);
  if (store.sessions[input.topic]) throw new Error(`session topic in use: ${input.topic}`);
  // Approved namespaces must cover every required chain+method.
  for (const [key, required] of Object.entries(proposal.requiredNamespaces)) {
    const approved = input.namespaces[key];
    if (!approved) throw new Error(`missing required namespace: ${key}`);
    for (const chain of required.chains) {
      if (!approved.chains.includes(chain)) throw new Error(`namespace ${key} missing chain ${chain}`);
    }
    for (const method of required.methods) {
      if (!approved.methods.includes(method)) throw new Error(`namespace ${key} missing method ${method}`);
    }
  }
  const session = WcSession.parse({
    topic: input.topic,
    peer: proposal.proposer,
    namespaces: input.namespaces,
    expiry: proposal.expiry,
    connectedAt: input.connectedAt,
  });
  return {
    store: {
      proposals: store.proposals.filter((p) => p.id !== input.proposalId),
      sessions: { ...store.sessions, [session.topic]: session },
      requests: store.requests,
    },
    session,
  };
}

export function rejectProposal(store: WcStore, proposalId: number): WcStore {
  const id = z.number().int().nonnegative().parse(proposalId);
  if (!store.proposals.some((p) => p.id === id)) throw new Error(`unknown wc proposal: ${id}`);
  return { ...store, proposals: store.proposals.filter((p) => p.id !== id) };
}

/** Remove a session and drain its pending request queue. */
export function removeSession(store: WcStore, topic: string): WcStore {
  const t = z.string().min(1).parse(topic);
  if (!store.sessions[t]) throw new Error(`unknown wc session: ${t}`);
  const sessions = { ...store.sessions };
  delete sessions[t];
  const requests = { ...store.requests };
  delete requests[t];
  return { ...store, sessions, requests };
}

/** Queue a peer session request. Unknown topics rejected (no blind queueing). */
export function queueSessionRequest(store: WcStore, raw: unknown): WcStore {
  const req = WcSessionRequest.parse(raw);
  if (!store.sessions[req.topic]) throw new Error(`request for unknown session: ${req.topic}`);
  const existing = store.requests[req.topic] ?? [];
  if (existing.some((r) => r.id === req.id)) {
    throw new Error(`duplicate wc request id ${req.id} on ${req.topic}`);
  }
  return { ...store, requests: { ...store.requests, [req.topic]: [...existing, req] } };
}

/** Pop a request for transport reply (approve/reject decided upstream). */
export function takeSessionRequest(
  store: WcStore,
  topic: string,
  requestId: number,
): { store: WcStore; request: WcSessionRequest } {
  const t = z.string().min(1).parse(topic);
  const id = z.number().int().parse(requestId);
  const list = store.requests[t] ?? [];
  const req = list.find((r) => r.id === id);
  if (!req) throw new Error(`unknown wc request ${id} on ${t}`);
  return { store: { ...store, requests: { ...store.requests, [t]: list.filter((r) => r.id !== id) } }, request: req };
}

export function pendingRequests(store: WcStore, topic: string): WcSessionRequest[] {
  const t = z.string().min(1).parse(topic);
  return [...(store.requests[t] ?? [])];
}

export function isSessionExpired(session: WcSession, nowMs: number): boolean {
  const s = WcSession.parse(session);
  return z.number().int().nonnegative().parse(nowMs) >= s.expiry;
}
