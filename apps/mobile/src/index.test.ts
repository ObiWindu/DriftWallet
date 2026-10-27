// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { deepLinkForWc } from "./index.js";

describe("mobile shell", () => {
  it("wraps wc uri", () => {
    expect(deepLinkForWc("wc:1234")).toContain("drift://wc");
  });
});
