// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { assetRows, chainTabs, homeBanner, portfolioSummary } from "./home.js";

describe("home screen VM", () => {
  it("sums portfolio fiat in bigint cents", () => {
    // 1.5 ETH @ $2000 + 0.5 BTC @ $60000 = $3000 + $30000 = $33000.00
    const t = portfolioSummary([
      { chainId: "eip155:1", symbol: "ETH", totalBaseUnits: 1_500_000_000_000_000_000n, decimals: 18, priceCents: 200_000n },
      { chainId: "bip122:000000000019d6689c085ae165831e93", symbol: "BTC", totalBaseUnits: 50_000_000n, decimals: 8, priceCents: 6_000_000n },
    ]);
    expect(t).toEqual({ totalFiat: "$33000.00", assetCount: 2, emptyKey: null });
  });

  it("handles dust and empty wallets", () => {
    const dust = portfolioSummary([
      { chainId: "eip155:1", symbol: "ETH", totalBaseUnits: 1n, decimals: 18, priceCents: 200_000n },
    ]);
    expect(dust.totalFiat).toBe("$0.00");
    expect(portfolioSummary([])).toEqual({ totalFiat: "$0.00", assetCount: 0, emptyKey: "home.empty" });
  });

  it("renders asset rows with exact amounts", () => {
    const rows = assetRows([
      { chainId: "solana:mainnet", symbol: "SOL", totalBaseUnits: 2_500_000_000n, decimals: 9, priceCents: 15_000n },
    ]);
    expect(rows).toEqual([{ chainId: "solana:mainnet", symbol: "SOL", amount: "2.5 SOL", fiat: "$375.00" }]);
  });

  it("builds chain tabs with selection", () => {
    const tabs = chainTabs("eip155:1");
    expect(tabs.length).toBe(8);
    expect(tabs.filter((t) => t.selected).map((t) => t.chainId)).toEqual(["eip155:1"]);
    expect(tabs.find((t) => t.chainId === "cardano:mainnet")?.label).toBe("Cardano");
    expect(chainTabs("unknown:9").some((t) => t.selected)).toBe(false);
  });

  it("gates the testnet banner on the mainnet flag", () => {
    expect(homeBanner(false)).toEqual({ bannerKey: "home.testnetBanner" });
    expect(homeBanner(true)).toBe(null);
  });
});
