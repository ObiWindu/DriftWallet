// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { buildServer } from "./index.js";

describe("gateway (zero keys)", () => {
  it("healthz + phishlist + push privacy", async () => {
    const app = buildServer();
    const h = await app.inject({ method: "GET", url: "/healthz" });
    expect(h.json()).toMatchObject({ ok: true, keysHeld: false });
    const p = await app.inject({ method: "GET", url: "/v1/phishlist" });
    expect(p.json().domains.length).toBeGreaterThan(0);
    const bad = await app.inject({ method: "POST", url: "/v1/push/subscribe", payload: { hashedAddrHex: "0x123", pushToken: "tok12345" } });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });
  it("balances stub + cache TTL", async () => {
    const app = buildServer();
    const r1 = await app.inject({ method: "GET", url: "/v1/evm/eip155:1/balance/0xabc" });
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ stub: true, cached: false });
    const r2 = await app.inject({ method: "GET", url: "/v1/evm/eip155:1/balance/0xabc" });
    expect(r2.json()).toMatchObject({ stub: true, cached: true });
    const s = await app.inject({ method: "GET", url: "/v1/sol/balance/So111" });
    expect(s.json()).toMatchObject({ stub: true });
    const b = await app.inject({ method: "GET", url: "/v1/btc/utxo/bc1qtest" });
    expect(b.json()).toMatchObject({ stub: true });
    const a = await app.inject({ method: "GET", url: "/v1/ada/utxo/addr1test" });
    expect(a.json()).toMatchObject({ stub: true });
    const t = await app.inject({ method: "GET", url: "/v1/tokens/eip155:1" });
    expect(t.json()).toMatchObject({ stub: true });
    const pr1 = await app.inject({ method: "GET", url: "/v1/prices" });
    expect(pr1.statusCode).toBe(200);
    await app.close();
  });
  it("rate limits with 429", async () => {
    const app = buildServer({ rateLimitMax: 3, rateLimitWindowMs: 60_000 });
    for (let i = 0; i < 3; i++) {
      const r = await app.inject({ method: "GET", url: "/healthz" });
      expect(r.statusCode).toBe(200);
    }
    const limited = await app.inject({ method: "GET", url: "/healthz" });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: "rate_limited" });
    await app.close();
  });
  it("openapi lists routes", async () => {
    const app = buildServer();
    const r = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.openapi).toBe("3.0.0");
    expect(j.paths["/v1/evm/{chainId}/balance/{addr}"]).toBeDefined();
    expect(j.paths["/v1/sol/balance/{addr}"]).toBeDefined();
    await app.close();
  });
  it("simulate stub + zod validation", async () => {
    const app = buildServer();
    const evm = await app.inject({
      method: "POST",
      url: "/v1/evm/simulate",
      payload: { chainId: "eip155:1", from: "0xabc", to: "0xdef", valueWei: "1000" },
    });
    expect(evm.statusCode).toBe(200);
    expect(evm.json()).toMatchObject({ stub: true, diff: null, cached: false });
    const evmBad = await app.inject({
      method: "POST",
      url: "/v1/evm/simulate",
      payload: { chainId: "eip155:1", from: "0xabc" },
    });
    expect(evmBad.statusCode).toBe(400);
    const sol = await app.inject({
      method: "POST",
      url: "/v1/sol/simulate",
      payload: { messageBase64: "aGVsbG8=" },
    });
    expect(sol.statusCode).toBe(200);
    expect(sol.json()).toMatchObject({ stub: true, diff: null, cached: false });
    const solBad = await app.inject({ method: "POST", url: "/v1/sol/simulate", payload: {} });
    expect(solBad.statusCode).toBe(400);
    await app.close();
  });
  it("openapi lists simulate routes", async () => {
    const app = buildServer();
    const r = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(r.json().paths["/v1/evm/simulate"]).toBeDefined();
    expect(r.json().paths["/v1/sol/simulate"]).toBeDefined();
    await app.close();
  });
});
