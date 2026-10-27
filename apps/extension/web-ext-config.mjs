// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// web-ext submit dry-run config (U051/U054). No credentials here —
// `web-ext sign` reads AMO issuer/secret from env (WEB_EXT_API_KEY/SECRET).
// Dry-run: `npx web-ext lint -s apps/extension/dist-firefox` and
// `npx web-ext build -s apps/extension/dist-firefox --artifacts-dir ...`.
// Real submit is manual: `npx web-ext sign --channel listed`.
export default {
  build: {
    overwriteDest: true,
  },
  run: {
    target: ["firefox-desktop"],
    startUrl: ["about:debugging#/runtime/this-firefox"],
  },
  sign: {
    channel: "unlisted",
  },
  lint: {
    selfHosted: true,
  },
  sourceDir: "apps/extension/dist-firefox",
  artifactsDir: "apps/extension/web-ext-artifacts",
  ignoreFiles: ["**/*.map"],
};
