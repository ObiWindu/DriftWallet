// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { createGatewayClient } from "./index.js";
import { createQueryClient, evmBalanceQuery, pricesQuery } from "./queries.js";

function mockFetch(responses: Record<string, unknown>) {
  return async (url: string): Promise<Response> => {
    const u = new URL(url);
    const body = responses[u.pathname + u.search] ?? responses[u.pathname];
    if (body === undefined) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  };
}

describe("gateway queries (tanstack query-core)", () => {
  it("fetches through QueryClient with mock transport", async () => {
    const client = createGatewayClient({
      baseUrl: "https://gateway.test",
      fetchFn: mockFetch({
        "/v1/prices?assets=ETH,SOL": { prices: { ETH: 3000, SOL: 150 }, cached: false },
        "/v1/evm/1/balance/0x0000000000000000000000000000000000000001": { balanceWei: "1000" },
      }),
    });
    const qc = createQueryClient();
    const prices = await qc.fetchQuery(pricesQuery(client, ["ETH", "SOL"]));
    expect(prices).toEqual({ ETH: 3000, SOL: 150 });
    const bal = await qc.fetchQuery(
      evmBalanceQuery(client, 1, "0x0000000000000000000000000000000000000001"),
    );
    expect(bal).toBe(1000n);
  });
});
