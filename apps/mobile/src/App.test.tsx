// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import App from "./App.tsx";

function testIDs(tree: ReactTestRenderer): string[] {
  return tree.root.findAll((n) => typeof n.props.testID === "string").map((n) => n.props.testID as string);
}

describe("App root", () => {
  it("renders onboarding for a fresh install", () => {
    const tree = create(createElement(App, { hasWallet: false }));
    const ids = testIDs(tree);
    expect(ids).toContain("app-root");
    expect(ids).not.toContain("watch-only-banner");
  });

  it("shows the persistent watch-only banner and never renders the Send screen", () => {
    const tree = create(createElement(App, { hasWallet: true, watchOnly: true, balances: [] }));
    const ids = testIDs(tree);
    expect(ids).toContain("watch-only-banner");
    expect(ids).toContain("tab-send"); // tab exists but is gated
    expect(ids).not.toContain("screen-send");
  });

  it("renders home with portfolio totals in bigint fiat", () => {
    const tree = create(
      createElement(App, {
        hasWallet: true,
        unlocked: true,
        balances: [
          { chainId: "eip155:1", symbol: "ETH", totalBaseUnits: 1_000_000_000_000_000_000n, decimals: 18, priceCents: 200_000n },
        ],
      }),
    );
    const ids = testIDs(tree);
    expect(ids).toContain("screen-home");
    const total = tree.root.findByProps({ testID: "home-total" });
    expect(String(total.props.children)).toBe("$2000.00");
  });
});
