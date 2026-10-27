import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Root fallback config. Canonical gates run per-package (`pnpm -w test`),
// where each package's own vitest.config.ts applies (RN alias, e2e excludes).
// This root config keeps ad-hoc root runs (`npx vitest run --dir <pkg>`)
// working the same way.
export default defineConfig({
  resolve: {
    alias: {
      "react-native": fileURLToPath(
        new URL("./packages/ui/src/__mocks__/react-native.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["**/src/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", "apps/extension/e2e/**"],
  },
});
