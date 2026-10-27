// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// U020 popup view-model tests.
import { describe, expect, it } from "vitest";
import { approveBadge, buildPopupView, selectNetwork } from "./popup-view.js";
import type { ApprovalEntry } from "./approval.js";

const networks = [
  { id: "eip155:11155111", label: "Sepolia", testnet: true, enabled: true },
  { id: "eip155:1", label: "Ethereum", testnet: false, enabled: false },
];

const queue: ApprovalEntry[] = [
  {
    id: "a1",
    origin: "https://app.example",
    method: "eth_sendTransaction",
    paramsSummary: "send",
    verdict: "allow",
    verdictReason: "ok",
    receivedAt: 1,
    decision: "pending",
  },
  {
    id: "a2",
    origin: "https://app.example",
    method: "eth_signTypedData_v4",
    paramsSummary: "sign",
    verdict: "stepUp",
    verdictReason: "auth",
    receivedAt: 2,
    decision: "approved",
  },
];

describe("popup view-model", () => {
  it("builds portfolio mini + badge + connect status", () => {
    const vm = buildPopupView({
      assets: [{ chain: "eip155:11155111", symbol: "ETH", balanceMinor: "1000000000000000000", decimals: 18, priceUsd: "3000" }],
      networks,
      selectedNetwork: "eip155:11155111",
      connectedOrigins: [{ origin: "https://app.example", connectedAt: 5 }],
      approvalQueue: queue,
    });
    expect(vm.portfolio.totalUsd).toBe("3000.00");
    expect(vm.selectedNetwork.label).toBe("Sepolia");
    expect(vm.connectedCount).toBe(1);
    expect(vm.pendingCount).toBe(1);
    expect(vm.badge).toBe("1");
  });

  it("caps badge at 9+", () => {
    expect(approveBadge(0)).toBe("");
    expect(approveBadge(9)).toBe("9");
    expect(approveBadge(10)).toBe("9+");
    expect(approveBadge(1234)).toBe("9+");
  });

  it("rejects unknown/disabled networks", () => {
    expect(() =>
      buildPopupView({
        assets: [],
        networks,
        selectedNetwork: "eip155:1",
        connectedOrigins: [],
        approvalQueue: [],
      }),
    ).toThrow(/disabled/);
    expect(() =>
      buildPopupView({
        assets: [],
        networks,
        selectedNetwork: "nope",
        connectedOrigins: [],
        approvalQueue: [],
      }),
    ).toThrow(/unknown network/);
  });

  it("selectNetwork is pure", () => {
    expect(selectNetwork(networks, "eip155:11155111").label).toBe("Sepolia");
    expect(() => selectNetwork(networks, "eip155:1")).toThrow(/disabled/);
    expect(() => selectNetwork(networks, "nope")).toThrow();
  });
});
