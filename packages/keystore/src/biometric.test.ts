// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { MemorySecureEnclave, generateDEK, unwrapDEK, wrapDEK } from "./biometric.js";

describe("biometric DEK", () => {
  it("wrap/unwrap round-trips, missing -> null", async () => {
    const e = new MemorySecureEnclave();
    expect(await unwrapDEK(e, "nope")).toBeNull();
    const dek = generateDEK(32);
    await wrapDEK(e, "k1", dek);
    const back = await unwrapDEK(e, "k1");
    expect(back).toEqual(dek);
    await e.removeDEK("k1");
    expect(await unwrapDEK(e, "k1")).toBeNull();
  });
});
