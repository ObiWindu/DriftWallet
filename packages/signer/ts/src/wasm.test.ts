// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { loadWasmSigner } from "./wasm.js";

describe("loadWasmSigner (extension offscreen)", () => {
  it("throws a helpful error when wasm-pkg is not built", async () => {
    await expect(loadWasmSigner()).rejects.toThrow(/wasm-pack|wasm-pkg|missing/i);
  });
});
