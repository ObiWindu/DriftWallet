// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { truncateAddress } from "./index.js";

describe("ui", () => {
  it("truncates", () => {
    expect(truncateAddress("0x1234567890abcdef")).toBe("0x1234…cdef");
  });
});
