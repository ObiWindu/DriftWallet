// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { isChainAllowed, isPathAllowed } from "./index.js";

describe("signer-ts guards (mirror Rust, defense in depth)", () => {
  it("allows known HD paths", () => {
    expect(isPathAllowed("m/44'/60'/0'/0/0")).toBe(true);
    expect(isPathAllowed("m/44'/501'/0'/0'")).toBe(true);
    expect(isPathAllowed("m/84'/0'/0'/0/0")).toBe(true);
    expect(isPathAllowed("m/1852'/1815'/0'/0/0")).toBe(true);
  });
  it("blocks unknown coin types", () => {
    expect(isPathAllowed("m/44'/999'/0'/0/0")).toBe(false);
    expect(isPathAllowed("m/44'/60'/0'/0")).toBe(false);
  });
  it("allows EVM chains, blocks others", () => {
    expect(isChainAllowed(1)).toBe(true);
    expect(isChainAllowed(8453)).toBe(true);
    expect(isChainAllowed(999999)).toBe(false);
  });
});
