// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "vitest/config";

// Unit tests only (src/**/*.test.ts). Playwright e2e lives in e2e/ and
// requires browsers + built extension — excluded from `vitest run`.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules"],
  },
});
