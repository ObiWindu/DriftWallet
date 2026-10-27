// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  buildSolanaMessage,
  validateSolanaAddress,
  buildSplTransfer,
  solanaFeeTiers,
  estimateSolFee,
  getBalance,
  getTokenAccounts,
  broadcast,
  type GatewayFetch,
} from "./index.js";

describe("chains-solana", () => {
  it("frames message and validates addresses", () => {
    const m = buildSolanaMessage({
      fromBase58: "11111111111111111111111111111111",
      toBase58: "11111111111111111111111111111111",
      lamports: "1000000", recentBlockhash: "GHtX",
    });
    expect(m.messageHex.length).toBeGreaterThan(0);
    expect(validateSolanaAddress("11111111111111111111111111111111")).toBe(true);
    expect(validateSolanaAddress("not-an-address!!")).toBe(false);
  });
});

function mockFetch(handler: (path: string, init?: RequestInit) => unknown): GatewayFetch {
  return (async (path: string, init?: RequestInit) => {
    return new Response(JSON.stringify(handler(path, init)), { status: 200 });
  }) as GatewayFetch;
}

const A1 = "11111111111111111111111111111111";
const A2 = "22222222222222222222222222222222";

describe("chains-solana T006", () => {
  it("buildSplTransfer frames transferChecked deterministically", () => {
    const r = buildSplTransfer({
      fromBase58: A1, toTokenAccountBase58: A2, mintBase58: A1,
      amountBaseUnits: "1000000", decimals: 6, recentBlockhash: "GHtX",
    });
    expect(r.messageHex.length).toBeGreaterThan(0);
    expect(r.feeLamports).toBe("5000");
    expect(r.mint).toBe(A1);
    expect(Buffer.from(r.messageHex, "hex").toString("utf8")).toContain("spl:");
    expect(() => buildSplTransfer({
      fromBase58: "bad!!", toTokenAccountBase58: A2, mintBase58: A1,
      amountBaseUnits: "1", decimals: 6, recentBlockhash: "GHtX",
    })).toThrow();
  });
  it("fee tiers are ordered bigint lamports", () => {
    const t = solanaFeeTiers();
    expect(t.low <= t.med && t.med <= t.high).toBe(true);
    expect(estimateSolFee("low")).toBe(t.low);
    expect(estimateSolFee("high")).toBe(t.high);
  });
  it("getBalance/getTokenAccounts/broadcast use injected GatewayFetch", async () => {
    const seen: string[] = [];
    const fetchFn = mockFetch((path: string, init?: RequestInit) => {
      seen.push(`${init?.method ?? "GET"} ${path}`);
      if (path.includes("/balance/")) return { lamports: "1000000" };
      if (path.includes("/tokens/"))
        return { accounts: [{ pubkey: A2, mint: A1, amountBaseUnits: "42", decimals: 6 }] };
      if (path.includes("/broadcast")) return { txSig: "sig123" };
      throw new Error(`unexpected ${path}`);
    });
    expect(await getBalance(fetchFn, A1)).toEqual({ lamports: 1000000n });
    const accs = await getTokenAccounts(fetchFn, A1);
    expect(accs).toEqual([{ pubkey: A2, mint: A1, amountBaseUnits: 42n, decimals: 6 }]);
    const signed = Buffer.from("signed-bytes-payload").toString("base64");
    expect(await broadcast(fetchFn, signed)).toEqual({ txSig: "sig123" });
    expect(seen.some((s) => s.includes("POST /v1/sol/broadcast"))).toBe(true);
    await expect(getBalance(fetchFn, "bad!!")).rejects.toThrow();
    await expect(broadcast(fetchFn, "!!!not-base64!!!")).rejects.toThrow();
  });
  it("broadcast surfaces gateway errors", async () => {
    const failing = (async () => new Response("oops", { status: 503 })) as GatewayFetch;
    const signed = Buffer.from("some-signed-payload").toString("base64");
    await expect(broadcast(failing, signed)).rejects.toThrow(/gateway 503/);
  });
});
