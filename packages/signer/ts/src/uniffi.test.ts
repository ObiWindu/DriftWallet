// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { loadNativeSigner } from "./uniffi.js";

describe("loadNativeSigner (mobile only)", () => {
  it("throws a descriptive error in node/web", async () => {
    await expect(loadNativeSigner()).rejects.toThrow(/mobile|react-native|NativeModules/i);
  });
});
