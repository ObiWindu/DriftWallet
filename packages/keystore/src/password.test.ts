// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { checkPasswordStrength } from "./password.js";

describe("password", () => {
  it("rejects short", () => {
    const r = checkPasswordStrength("abc");
    expect(r.score).toBe(0);
    expect(r.passesForNewWallet).toBe(false);
  });
  it("rejects common", () => {
    const r = checkPasswordStrength("password123");
    expect(r.passesForNewWallet).toBe(false);
  });
  it("accepts strong", () => {
    const r = checkPasswordStrength("correct-horse-8!Zx");
    expect(r.score).toBeGreaterThanOrEqual(3);
    expect(r.passesForNewWallet).toBe(true);
  });
  it("scores 0-4 deterministically", () => {
    for (const pw of ["aB1!aB1!aB1!xyzQ", "Tr7$mQp9!vX2#kL4z", "short1!"]) {
      const r = checkPasswordStrength(pw);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(4);
    }
  });
});
