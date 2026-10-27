// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { RpcMsg, reviewManifest } from "./background.js";

describe("extension MV3 guards", () => {
  it("validates dapp messages", () => {
    expect(() => RpcMsg.parse({ channel: "drift-v1", method: "eth_sendTransaction", origin: "https://app.example", payload: {} })).not.toThrow();
    expect(() => RpcMsg.parse({ channel: "evil", method: "eth_sendTransaction", origin: "https://app.example", payload: {} })).toThrow();
  });
  it("blocks <all_urls>", () => {
    expect(reviewManifest({ permissions: ["storage", "<all_urls>"] }).length).toBeGreaterThan(0);
    expect(reviewManifest({ permissions: ["storage", "alarms"] }).length).toBe(0);
  });
});
