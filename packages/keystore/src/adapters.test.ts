// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { ChromeStorageAdapter, FirefoxStorageAdapter, MmkvStorage } from "./adapters.js";
import type { EncryptedVault } from "./index.js";

function vault(): EncryptedVault {
  return {
    version: 1,
    saltHex: "ab".repeat(16),
    nonceHex: "cd".repeat(12),
    ciphertextHex: "ef".repeat(32),
    argon2: { mKib: 8192, tCost: 1, pCost: 1 },
  };
}

describe("adapters", () => {
  it("MmkvStorage round-trips + validates + rejects bad cryptKey", async () => {
    const s = new MmkvStorage({ cryptKey: "k" });
    await s.save("v1", vault());
    expect((await s.load("v1"))?.ciphertextHex).toBe(vault().ciphertextHex);
    await s.remove("v1");
    expect(await s.load("v1")).toBeNull();
    await expect(async () => new MmkvStorage({ cryptKey: "" })).rejects.toThrow();
    // corrupt blob fails zod on load
    await s.save("bad", vault());
    (s as unknown as { map: Map<string, unknown> }).map.set("bad", { version: 1 });
    await expect(s.load("bad")).rejects.toThrow();
  });
  it("ChromeStorageAdapter falls back in-memory + session id", async () => {
    const s = new ChromeStorageAdapter();
    await s.save("v1", vault());
    expect(await s.load("v1")).toMatchObject({ version: 1 });
    await s.saveSessionId("v1", 7);
    expect(await s.loadSessionId("v1")).toBe(7);
    await s.remove("v1");
    expect(await s.load("v1")).toBeNull();
  });
  it("FirefoxStorageAdapter falls back in-memory", async () => {
    const s = new FirefoxStorageAdapter();
    await s.save("v1", vault());
    expect((await s.load("v1"))?.saltHex).toBe(vault().saltHex);
    expect(await s.load("missing")).toBeNull();
  });
});
