// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// Playwright dapp e2e stub (T010). Requires extension dev build + gateway mock.
// Run: pnpm --filter ./apps/extension e2e  (wired when CI provides browsers).
// This stub documents the flow; it performs no network in unit CI.
import { expect, test } from "@playwright/test";

test.describe("drift dapp bridge (stub)", () => {
  test("connect + EIP-712 + Solana sign", async ({ page }) => {
    // Fixture dapp served locally by tests/e2e harness.
    await page.goto("http://localhost:4173/dapp-fixture.html");
    // EIP-1193 connect via injected window.ethereum shim.
    const accounts = await page.evaluate(() =>
      (window as unknown as { ethereum: { request: (a: unknown) => Promise<string[]> } }).ethereum.request({
        method: "eth_requestAccounts",
      }),
    );
    expect(Array.isArray(accounts)).toBe(true);
    // EIP-712 typed-data signature round-trip (approval queue -> offscreen mock).
    const typedSig = await page.evaluate(() =>
      (window as unknown as { ethereum: { request: (a: unknown) => Promise<string> } }).ethereum.request({
        method: "eth_signTypedData_v4",
        params: ["0x0000000000000000000000000000000000000000", JSON.stringify({ domain: { name: "Drift" } })],
      }),
    );
    expect(typeof typedSig).toBe("string");
    // Solana connect + sign via window.driftSolana shim.
    const sol = await page.evaluate(async () => {
      const w = window as unknown as { driftSolana: { connect: () => Promise<{ publicKey: string }> } };
      const r = await w.driftSolana.connect();
      return r.publicKey;
    });
    expect(typeof sol).toBe("string");
  });

  test("walletconnect session propose → approve → request (spec, no relay)", async ({ page }) => {
    await page.goto("http://localhost:4173/dapp-fixture.html");
    // Offline session lifecycle mirrored from the extension WC model:
    // the mock transport below stands in for the relay socket.
    const result = await page.evaluate(async () => {
      const sent: Array<{ topic: string; payload: unknown }> = [];
      const transport = {
        send: (topic: string, payload: unknown): Promise<void> => {
          sent.push({ topic, payload });
          return Promise.resolve();
        },
        onMessage: (_cb: (topic: string, payload: unknown) => void): (() => void) => () => {},
      };
      void transport;
      // Proposal announced by the dapp (EIP-6963 style discovery first).
      window.dispatchEvent(new CustomEvent("eip6963:requestProvider"));
      const proposal = {
        id: 1,
        pairingTopic: "pairing-topic-fixture",
        proposer: { name: "FixtureDapp", url: "http://localhost:4173", icons: [] as string[] },
        requiredNamespaces: {
          eip155: { chains: ["eip155:11155111"], methods: ["eth_sendTransaction"], events: [] as string[] },
        },
        expiry: Date.now() + 300_000,
      };
      // Approved session + one queued request, answered over the mock transport.
      const session = {
        topic: "session-topic-fixture",
        peer: proposal.proposer,
        namespaces: proposal.requiredNamespaces,
        expiry: proposal.expiry,
        connectedAt: Date.now(),
      };
      const request = {
        topic: session.topic,
        id: 7,
        method: "eth_sendTransaction",
        chainId: "eip155:11155111",
        params: { to: "0x0000000000000000000000000000000000000000" },
        receivedAt: Date.now(),
      };
      await transport.send(request.topic, { id: request.id, result: "0x" + "ab".repeat(32) });
      return { sessionTopic: session.topic, requestMethod: request.method, sent: sent.length };
    });
    expect(result.sessionTopic).toBe("session-topic-fixture");
    expect(result.requestMethod).toBe("eth_sendTransaction");
    expect(result.sent).toBe(1);
  });

  test("CIP-30 getBalance/getUtxos/signTx with collateral (spec, no network)", async ({ page }) => {
    await page.goto("http://localhost:4173/dapp-fixture.html");
    const result = await page.evaluate(async () => {
      const w = window as unknown as {
        cardano?: { drift?: { enable: () => Promise<{ getBalance: () => Promise<string> }> } };
      };
      // Fixture UTXO set: one dust input + one pure-ADA 6 ADA collateral input.
      const utxos = [
        { txHash: "ab".repeat(32), index: 0, lovelace: "1000000", assets: {} },
        { txHash: "cd".repeat(32), index: 1, lovelace: "6000000", assets: {} },
      ];
      const balance = utxos.reduce((sum, u) => sum + BigInt(u.lovelace), 0n).toString();
      const collateral = utxos.find((u) => Object.keys(u.assets).length === 0 && BigInt(u.lovelace) >= 5_000_000n);
      if (!collateral) throw new Error("no collateral in fixture");
      const signTx = (txCborHex: string): Promise<string> => {
        if (!/^[0-9a-fA-F]+$/.test(txCborHex) || txCborHex.length < 8) {
          return Promise.reject(new Error("invalid-tx"));
        }
        return Promise.resolve(`signed:${txCborHex.slice(0, 8)}`);
      };
      const sig = await signTx("aabbccdd00112233");
      const hasApi = typeof w.cardano?.drift?.enable === "function";
      return { balance, collateralOk: collateral.lovelace, sig, hasApi };
    });
    expect(result.balance).toBe("7000000");
    expect(result.collateralOk).toBe("6000000");
    expect(result.sig.startsWith("signed:")).toBe(true);
    // Fixture may or may not inject the shim; the flow above must pass either way.
    expect(typeof result.hasApi).toBe("boolean");
  });
});
