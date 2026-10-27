// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "vite";

// Single-file IIFE bundle (content script). No code-splitting: this execution
// context forbids dynamic chunk loading.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    minify: true,
    rollupOptions: {
      input: "src/content-script-main.ts",
      output: {
        entryFileNames: "content-script.js",
        format: "iife",
        inlineDynamicImports: true,
      },
    },
  },
});
