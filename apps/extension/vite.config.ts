// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "vite";

// Page bundles (popup / full-page / offscreen). The service worker and
// content-script ship as single-file IIFEs via vite.workers.config.ts
// (MV3 service workers + content scripts must not code-split).
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: "popup.html",
        app: "app.html",
        offscreen: "offscreen.html",
      },
    },
  },
});
