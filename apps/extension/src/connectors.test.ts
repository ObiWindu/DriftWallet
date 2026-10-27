// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// U023 tests: WalletConnect v2 session model + EIP-6963 discovery.
import { describe, expect, it } from "vitest";
import {
  approveSession,
  emptyWcStore,
  isSessionExpired,
  pendingRequests,
  proposeSession,
  queueSessionRequest,
  rejectProposal,
  removeSession,
  takeSessionRequest,
} from "./walletconnect.js";
import {
  buildAnnounce,
  buildRequestProvider,
  driftProviderInfo,
  EIP6963_ANNOUNCE_EVENT,
  EIP6963_REQUEST_EVENT,
  isAnnounceMessage,
  parseAnnounce,
} from "./eip6963.js";

const proposer = { name: "TestDapp", url: "https://dapp.example", icons: [] as string[] };
const requiredNamespaces = {
  eip155: { chains: ["eip155:11155111"], methods: ["eth_sendTransaction"], events: [] },
};

function proposal(id = 1) {
  return {
    id,
    pairingTopic: "pairing-topic-abcdef",
    proposer,
    requiredNamespaces,
    expiry: 9_999_999_999_999,
  };
}

describe("walletconnect sessions", () => {
  it("propose → approve → request queue → take → remove", () => {
    let store = emptyWcStore();
    store = proposeSession(store, proposal());
    expect(() => proposeSession(store, proposal())).toThrow(/duplicate/);
    const { store: s2, session } = approveSession(store, {
      proposalId: 1,
      topic: "session-topic-12345678",
      namespaces: requiredNamespaces,
      connectedAt: 100,
    });
    expect(session.peer.name).toBe("TestDapp");
    expect(s2.proposals).toHaveLength(0);
    // request on unknown topic rejected
    expect(() =>
      queueSessionRequest(s2, { topic: "nope", id: 1, method: "eth_sendTransaction", chainId: "eip155:11155111", params: {}, receivedAt: 101 }),
    ).toThrow(/unknown session/);
    const s3 = queueSessionRequest(s2, {
      topic: session.topic,
      id: 7,
      method: "eth_sendTransaction",
      chainId: "eip155:11155111",
      params: { to: "0xabc" },
      receivedAt: 102,
    });
    expect(pendingRequests(s3, session.topic)).toHaveLength(1);
    expect(() =>
      queueSessionRequest(s3, { topic: session.topic, id: 7, method: "x", chainId: "y", params: {}, receivedAt: 103 }),
    ).toThrow(/duplicate/);
    const { store: s4, request } = takeSessionRequest(s3, session.topic, 7);
    expect(request.method).toBe("eth_sendTransaction");
    expect(pendingRequests(s4, session.topic)).toHaveLength(0);
    const s5 = removeSession(s4, session.topic);
    expect(Object.keys(s5.sessions)).toHaveLength(0);
  });

  it("approve enforces required namespaces", () => {
    const store = proposeSession(emptyWcStore(), proposal());
    expect(() =>
      approveSession(store, {
        proposalId: 1,
        topic: "session-topic-12345678",
        namespaces: { eip155: { chains: ["eip155:1"], methods: ["eth_sendTransaction"], events: [] } },
        connectedAt: 1,
      }),
    ).toThrow(/missing chain/);
    expect(() =>
      approveSession(store, {
        proposalId: 1,
        topic: "session-topic-12345678",
        namespaces: { other: { chains: ["x"], methods: ["y"], events: [] } },
        connectedAt: 1,
      }),
    ).toThrow(/missing required namespace/);
  });

  it("reject + expiry", () => {
    const store = proposeSession(emptyWcStore(), proposal());
    expect(rejectProposal(store, 1).proposals).toHaveLength(0);
    expect(() => rejectProposal(store, 999)).toThrow();
    const { session } = approveSession(store, {
      proposalId: 1,
      topic: "session-topic-12345678",
      namespaces: requiredNamespaces,
      connectedAt: 1,
    });
    expect(isSessionExpired(session, 100)).toBe(false);
    expect(isSessionExpired(session, 9_999_999_999_999)).toBe(true);
  });
});

describe("eip-6963 discovery", () => {
  it("builds/parses announce + request messages", () => {
    const info = driftProviderInfo("install-uuid-1");
    const msg = buildAnnounce(info);
    expect(msg.type).toBe(EIP6963_ANNOUNCE_EVENT);
    expect(msg.detail.info.rdns).toBe("wallet.drift");
    expect(isAnnounceMessage(msg)).toBe(true);
    expect(isAnnounceMessage({ type: "nope" })).toBe(false);
    expect(parseAnnounce(msg)?.uuid).toBe("install-uuid-1");
    expect(parseAnnounce({ type: EIP6963_ANNOUNCE_EVENT, detail: {} })).toBeNull();
    expect(buildRequestProvider().type).toBe(EIP6963_REQUEST_EVENT);
    expect(() => driftProviderInfo("")).toThrow();
  });
});
