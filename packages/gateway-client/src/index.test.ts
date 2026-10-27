// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  pushSubscribeBody,
  createGatewayClient,
  CLIENT_VERSION_HEADER,
  type FetchFn,
} from "./index.js";

describe("gateway-client privacy", () => {
  it("requires hashed addresses for push", () => {
    expect(() => pushSubscribeBody("ab".repeat(32), "token12345")).not.toThrow();
    expect(() => pushSubscribeBody("0x1234", "token12345")).toThrow();
  });
});

function mockFetch(routes: Record<string, unknown>, seen: Array<{ url: string; init: RequestInit | undefined }>): FetchFn {
  return (async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const key = Object.keys(routes).find((k) => path === k || path.startsWith(`${k}?`) || path.startsWith(`${k}/`))
      ?? path;
    const body = routes[key] ?? routes[path];
    if (body === undefined) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as FetchFn;
}

describe("gateway-client T008", () => {
  const ADDR = "0x0000000000000000000000000000000000000001";
  function setup() {
    const seen: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchFn = mockFetch(
      {
        "/v1/prices": { prices: { ETH: 3000, SOL: 150 }, cached: true },
        "/v1/evm/1/balance": { balanceWei: "1000000000000000000" },
        "/v1/evm/1/broadcast": { txHash: `0x${"ab".repeat(32)}` },
        "/v1/sol/broadcast": { txSig: "sig123" },
        "/v1/btc/broadcast": { txid: "cc".repeat(32) },
        "/v1/ada/broadcast": { txHash: "ada-hash-1" },
        "/v1/phishlist": { domains: ["evil.example"], updatedAt: "2026-01-01T00:00:00.000Z" },
        "/v1/push/subscribe": { ok: true },
      },
      seen,
    );
    const client = createGatewayClient({ baseUrl: "https://gw.example", apiKey: "k", fetchFn });
    return { client, seen };
  }

  it("getPrices/getEvmBalance validate and return typed values", async () => {
    const { client, seen } = setup();
    expect(await client.getPrices(["ETH", "SOL"])).toEqual({ ETH: 3000, SOL: 150 });
    expect(await client.getEvmBalance(1, ADDR)).toBe(10n ** 18n);
    expect(seen[0]?.url).toContain("/v1/prices?assets=ETH,SOL");
    await expect(client.getPrices([])).rejects.toThrow();
    await expect(client.getEvmBalance(1, "0xbad")).rejects.toThrow();
  });
  it("broadcasts validate payloads and parse tx hashes", async () => {
    const { client } = setup();
    expect(await client.broadcastEvm(1, "0x02f86deadbeef")).toBe(`0x${"ab".repeat(32)}`);
    expect(await client.broadcastSol(Buffer.from("signed-sol").toString("base64"))).toBe("sig123");
    const psbt = Buffer.concat([Buffer.from("psbt\xff", "binary"), Buffer.alloc(8)]).toString("base64");
    expect(await client.broadcastBtc(psbt)).toBe("cc".repeat(32));
    expect(await client.broadcastAda("deadbeef".repeat(8))).toBe("ada-hash-1");
    await expect(client.broadcastEvm(1, "not-hex")).rejects.toThrow();
    await expect(client.broadcastBtc(Buffer.from("junk").toString("base64"))).rejects.toThrow(/psbt magic/);
  });
  it("getPhishlist/subscribePush round-trip; push requires sha256 hex", async () => {
    const { client } = setup();
    expect(await client.getPhishlist()).toEqual({ domains: ["evil.example"], updatedAt: "2026-01-01T00:00:00.000Z" });
    expect(await client.subscribePush("ab".repeat(32), "token12345")).toEqual({ ok: true });
    await expect(client.subscribePush("0x1234", "token12345")).rejects.toThrow(/sha256/);
  });
  it("sets X-Drift-Client header and bearer auth, never sends raw seed", async () => {
    const { client, seen } = setup();
    await client.getPrices(["ETH"]);
    const headers = (seen[0]?.init?.headers ?? {}) as Record<string, string>;
    expect(headers["X-Drift-Client"]).toBe(CLIENT_VERSION_HEADER);
    expect(headers["authorization"]).toBe("Bearer k");
    // No method accepts seed-like params: assert the client surface.
    expect(Object.keys(client).sort()).toEqual([
      "broadcastAda", "broadcastBtc", "broadcastEvm", "broadcastSol",
      "getEvmBalance", "getPhishlist", "getPrices", "subscribePush",
    ]);
    const bodies = seen.map((s) => String(s.init?.body ?? ""));
    expect(bodies.join(" ")).not.toMatch(/mnemonic|seed|entropy/i);
  });
  it("surfaces gateway errors and bad shapes", async () => {
    const failing = (async () => new Response("oops", { status: 500 })) as FetchFn;
    const client = createGatewayClient({ baseUrl: "https://gw.example", fetchFn: failing });
    await expect(client.getPrices(["ETH"])).rejects.toThrow(/gateway 500/);
    const badShape = mockFetch({ "/v1/prices": { nope: 1 } }, []);
    const bad = createGatewayClient({ baseUrl: "https://gw.example", fetchFn: badShape });
    await expect(bad.getPrices(["ETH"])).rejects.toThrow();
  });
});
