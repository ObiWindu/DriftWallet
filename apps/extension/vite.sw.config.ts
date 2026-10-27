// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "vite";

// Single-file IIFE bundle (MV3 service worker). No code-splitting: this execution
// context forbids dynamic chunk loading.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    minify: true,
    rollupOptions: {
      input: "src/service-worker.ts",
      output: {
        entryFileNames: "background.js",
        format: "iife",
        inlineDynamicImports: true,
      },
    },
  },
});
