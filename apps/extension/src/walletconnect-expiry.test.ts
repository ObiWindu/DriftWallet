// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  approveSession,
  emptyWcStore,
  expireSessions,
  isSessionExpired,
  proposeSession,
  pruneExpiredProposals,
  queueSessionRequest,
  rejectProposal,
  removeSession,
  sessionCoversChain,
  type WcStore,
} from "./walletconnect.js";
import { defaultSettings, updateSettings, watchOnlyGuard } from "./app-model.js";

const proposal = {
  id: 1,
  pairingTopic: "pairingtopic1",
  proposer: { name: "Dapp", url: "https://dapp.example" },
  requiredNamespaces: { eip155: { chains: ["eip155:1"], methods: ["eth_sendTransaction"], events: [] } },
  expiry: 2000,
};

function storeWithSession(expiry: number): { store: WcStore; topic: string } {
  let store = emptyWcStore();
  store = proposeSession(store, proposal);
  const { store: s2, session } = approveSession(store, {
    proposalId: 1,
    topic: "sessiontopic1",
    namespaces: { eip155: { chains: ["eip155:1"], methods: ["eth_sendTransaction"], events: [] } },
    connectedAt: 1000,
  });
  void session;
  // force expiry
  s2.sessions["sessiontopic1"] = { ...s2.sessions["sessiontopic1"]!, expiry };
  return { store: s2, topic: "sessiontopic1" };
}

describe("walletconnect iteration 3 — expiry, phish guard, chain coverage", () => {
  it("expireSessions prunes expired sessions + their requests", () => {
    const { store, topic } = storeWithSession(1500);
    const withReq = queueSessionRequest(store, {
      topic, id: 7, method: "eth_sendTransaction", chainId: "eip155:1", params: {}, receivedAt: 1200,
    });
    expect(Object.keys(withReq.sessions)).toHaveLength(1);
    const pruned = expireSessions(withReq, 1600); // past expiry 1500
    expect(pruned.sessions[topic]).toBeUndefined();
    expect(pruned.requests[topic]).toBeUndefined();
    const kept = expireSessions(withReq, 1400); // before expiry
    expect(kept.sessions[topic]).toBeDefined();
    expect(isSessionExpired(store.sessions[topic]!, 1500)).toBe(true);
  });

  it("pruneExpiredProposals drops stale proposals only", () => {
    let store = emptyWcStore();
    store = proposeSession(store, proposal);
    store = proposeSession(store, { ...proposal, id: 2, expiry: 5000 });
    const pruned = pruneExpiredProposals(store, 3000);
    expect(pruned.proposals.map((p) => p.id)).toEqual([2]);
    expect(rejectProposal(store, 1).proposals.map((p) => p.id)).toEqual([2]);
  });

  it("proposeSession blocks phishing proposer via injected guard", () => {
    let store = emptyWcStore();
    store = proposeSession(store, proposal, { isPhish: () => false });
    expect(store.proposals).toHaveLength(1);
    expect(() =>
      proposeSession(emptyWcStore(), { ...proposal, id: 9, proposer: { name: "Evil", url: "https://evil-drain.example" } }, { isPhish: (u) => u.includes("evil-drain") }),
    ).toThrow(/phishing/);
  });

  it("removeSession drains requests; sessionCoversChain checks namespaces", () => {
    const { store, topic } = storeWithSession(9999);
    const withReq = queueSessionRequest(store, { topic, id: 1, method: "personal_sign", chainId: "eip155:1", params: "0x", receivedAt: 1 });
    const removed = removeSession(withReq, topic);
    expect(removed.sessions[topic]).toBeUndefined();
    expect(removed.requests[topic]).toBeUndefined();
    const s = store.sessions[topic]!;
    expect(sessionCoversChain(s, "eip155:1")).toBe(true);
    expect(sessionCoversChain(s, "eip155:56")).toBe(false);
  });
});

describe("watch-only guard (F-P1-10)", () => {
  it("watch-only settings disable signing and always set the banner", () => {
    const on = updateSettings(defaultSettings(), { watchOnly: true });
    const g = watchOnlyGuard(on);
    expect(g).toMatchObject({ watchOnly: true, canSign: false });
    expect(g.banner).toMatch(/Watch-only/);
    const off = watchOnlyGuard(defaultSettings());
    expect(off).toMatchObject({ watchOnly: false, canSign: true, banner: null });
  });

  it("settings carry a spend limit in cents with safe default", () => {
    expect(defaultSettings().spendLimitUsdCents).toBe("0");
    const s = updateSettings(defaultSettings(), { spendLimitUsdCents: "50000" });
    expect(s.spendLimitUsdCents).toBe("50000");
    expect(() => updateSettings(defaultSettings(), { spendLimitUsdCents: "12.5" })).toThrow();
  });
});
