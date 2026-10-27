// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "react-native": fileURLToPath(new URL("./src/__mocks__/react-native.ts", import.meta.url)),
    },
  },
  test: { include: ["src/**/*.test.{ts,tsx}"] },
});
