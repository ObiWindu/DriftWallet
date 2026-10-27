// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// U023 tests: CIP-30 API model + Solana wallet-standard model.
import { describe, expect, it } from "vitest";
import {
  buildCip30SignRequest,
  checkCollateral,
  Cip30Exception,
  getBalanceLovelace,
  getUtxos,
  MIN_COLLATERAL_LOVELACE,
} from "./cip30.js";
import {
  solanaConnect,
  solanaDisconnect,
  solanaSignMessage,
  solanaSignTransaction,
} from "./solana-standard.js";

const ADDR = "Drift1111111111111111111111111111111111111";
const utxo = (lovelace: string, assets = {}) => ({
  txHash: "ab".repeat(32),
  index: 0,
  lovelace,
  assets,
});

describe("cip-30 model", () => {
  it("sums balances + filters utxos as bigint", () => {
    const utxos = [utxo("5000000"), utxo("123456789012345678901234567890")];
    expect(getBalanceLovelace(utxos)).toBe(5000000n + 123456789012345678901234567890n);
    expect(getUtxos(utxos, 6_000_000n)).toHaveLength(1);
    expect(getUtxos(utxos)).toHaveLength(2);
    expect(() => getBalanceLovelace([{ nope: 1 }])).toThrow();
  });

  it("enforces the collateral rule", () => {
    expect(MIN_COLLATERAL_LOVELACE).toBe(5_000_000n);
    const ok = checkCollateral([utxo("100", { "policy.asset": "5" }), utxo("6000000")]);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.utxo.lovelace).toBe("6000000");
    const dust = checkCollateral([utxo("4999999")]);
    expect(dust.ok).toBe(false);
    if (!dust.ok) expect(dust.error.code).toBe("no-collateral");
    const onlyAssets = checkCollateral([utxo("99999999", { "policy.asset": "1" })]);
    expect(onlyAssets.ok).toBe(false);
  });

  it("builds sign requests, throws typed errors", () => {
    const req = buildCip30SignRequest("aabbccdd", { utxos: [utxo("6000000")] });
    expect(req.method).toBe("cardano_signTx");
    expect(req.collateral?.lovelace).toBe("6000000");
    // missing collateral → no-collateral
    try {
      buildCip30SignRequest("aabbccdd", { utxos: [utxo("1")] });
      expect.unreachable();
    } catch (e) {
      expect((e as Cip30Exception).code).toBe("no-collateral");
    }
    // short hex → invalid-tx
    expect(() => buildCip30SignRequest("ab", { requireCollateral: false })).toThrow();
    // collateral check skippable (e.g. read-only preview)
    const noCol = buildCip30SignRequest("aabbccdd", { requireCollateral: false });
    expect(noCol.collateral).toBeNull();
  });
});

describe("solana wallet-standard model", () => {
  it("connects, signs, disconnects", () => {
    const session = solanaConnect([ADDR], 100);
    expect(session.address).toBe(ADDR);
    expect(session.chains).toContain("solana:mainnet");
    const tx = solanaSignTransaction(session, "aGVsbG8tdHgtYnl0ZXM=");
    expect(tx.method).toBe("solana_signTransaction");
    if (!("txBase64" in tx.payload)) throw new Error("expected tx payload");
    const msg = solanaSignMessage(session, "hello drift");
    if (!("messageUtf8" in msg.payload)) throw new Error("expected message payload");
    expect(msg.payload.messageUtf8).toBe("hello drift");
    expect(solanaDisconnect(session)).toBeNull();
  });

  it("rejects bad input", () => {
    expect(() => solanaConnect([], 1)).toThrow();
    expect(() => solanaConnect(["not-base58!!!"], 1)).toThrow();
    const session = solanaConnect([ADDR], 1);
    expect(() => solanaSignTransaction(session, "!!!")).toThrow();
    expect(() => solanaSignMessage(session, "")).toThrow();
  });
});
