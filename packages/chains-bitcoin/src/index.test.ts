// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import {
  checkFeePolicy,
  validatePsbtEnvelope,
  buildPsbt,
  broadcast,
  dustLimitSats,
  RBF_SEQUENCE,
  type GatewayFetch,
} from "./index.js";

describe("chains-bitcoin", () => {
  it("enforces fee policy (mirror Rust)", () => {
    expect(() => checkFeePolicy(100_000n, 99_500n, 500n, false)).not.toThrow();
    expect(() => checkFeePolicy(100_000n, 90_000n, 10_000n, false)).toThrow();
    expect(() => checkFeePolicy(100_000n, 90_000n, 10_000n, true)).not.toThrow();
  });
  it("validates PSBT magic", () => {
    const good = Buffer.concat([Buffer.from("psbt\xff", "binary"), Buffer.alloc(16)]).toString("base64");
    expect(() => validatePsbtEnvelope(good)).not.toThrow();
    expect(() => validatePsbtEnvelope(Buffer.from("junk").toString("base64"))).toThrow();
  });
});

function tb1q(hashHex20: string): string {
  return bitcoin.address.fromOutputScript(
    Buffer.from(`0014${hashHex20}`, "hex"),
    bitcoin.networks.testnet,
  );
}

describe("chains-bitcoin T006", () => {
  const A = tb1q("11".repeat(20));
  const B = tb1q("22".repeat(20));
  const C = tb1q("33".repeat(20));

  function utxos() {
    return [
      { txid: "aa".repeat(32), vout: 0, valueSats: "100000", address: A },
      { txid: "bb".repeat(32), vout: 1, valueSats: "50000", address: A },
    ];
  }

  it("builds a PSBT with fake UTXOs that passes envelope validation", () => {
    const built = buildPsbt({ utxos: utxos(), toBech32: B, amountSats: "100000", feeRateSatVb: "5", changeBech32: C });
    expect(() => validatePsbtEnvelope(built.psbtBase64)).not.toThrow();
    expect(built.inputCount).toBeGreaterThanOrEqual(1);
    expect(built.outputCount).toBe(2);
    expect(built.totalInSats - built.totalOutSats).toBe(built.feeSats);
    expect(built.changeSats).toBeGreaterThanOrEqual(dustLimitSats());
    // RBF sequence on every input.
    const psbt = bitcoin.Psbt.fromBase64(built.psbtBase64);
    expect(psbt.inputCount).toBe(built.inputCount);
    for (const txi of psbt.txInputs) expect(txi.sequence).toBe(RBF_SEQUENCE);
  });
  it("selects largest-first and absorbs dust change", () => {
    // Tiny second UTXO forces dust-change path when amount ~= total.
    const built = buildPsbt({
      utxos: [
        { txid: "cc".repeat(32), vout: 0, valueSats: "10000", address: A },
        { txid: "dd".repeat(32), vout: 0, valueSats: "600", address: A },
      ],
      toBech32: B,
      amountSats: "9000",
      feeRateSatVb: "2",
      changeBech32: C,
    });
    expect(built.inputCount).toBe(1); // largest-first: 10000 alone covers
    expect(built.changeSats >= dustLimitSats() || built.changeSats === 0n).toBe(true);
  });
  it("rejects insufficient funds, dust outputs, network mismatch", () => {
    expect(() => buildPsbt({
      utxos: utxos(), toBech32: B, amountSats: "999999999", feeRateSatVb: "5", changeBech32: C,
    })).toThrow(/insufficient/);
    expect(() => buildPsbt({
      utxos: utxos(), toBech32: B, amountSats: "100", feeRateSatVb: "5",
      changeBech32: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
    })).toThrow(/network/);
    expect(() => buildPsbt({
      utxos: [{ txid: "ee".repeat(32), vout: 0, valueSats: "100000", scriptPubKeyHex: "76a914" + "11".repeat(20) + "88ac" }],
      toBech32: B, amountSats: "50000", feeRateSatVb: "1", changeBech32: C,
    })).toThrow(/P2WPKH/);
  });
  it("builds Taproot key-path inputs with tapInternalKey + RBF", () => {
    // P2TR script: OP_1 <32B x-only>. Program is arbitrary for construction;
    // the signer tweaks + Schnorr-signs it (see Rust U031 vectors).
    const XONLY = "a60869f0dbcf1dc659c9cecbaf8050135ea9e8cdc487053f1dc6880949dc684c";
    const built = buildPsbt({
      utxos: [
        { txid: "aa".repeat(32), vout: 0, valueSats: "100000", address: A },
        { txid: "bb".repeat(32), vout: 0, valueSats: "80000", scriptPubKeyHex: `5120${XONLY}` },
      ],
      toBech32: B,
      amountSats: "150000",
      feeRateSatVb: "5",
      changeBech32: C,
    });
    expect(built.inputCount).toBe(2);
    const psbt = bitcoin.Psbt.fromBase64(built.psbtBase64);
    const trIn = psbt.data.inputs[1];
    if (!trIn?.tapInternalKey) throw new Error("taproot input missing");
    expect(Buffer.from(trIn.tapInternalKey as Uint8Array).toString("hex")).toBe(XONLY);
    for (const txi of psbt.txInputs) expect(txi.sequence).toBe(RBF_SEQUENCE);
    // Mixed vsize: 1xP2WPKH (68) + 1xP2TR (58) < all-P2WPKH estimate.
    const mixedFee = BigInt(Math.ceil(10.5 + 68 + 58 + 31 * built.outputCount)) * 5n;
    expect(built.feeSats).toBe(mixedFee);
  });
  it("broadcasts via injected GatewayFetch (no network)", async () => {
    const built = buildPsbt({ utxos: utxos(), toBech32: B, amountSats: "100000", feeRateSatVb: "5", changeBech32: C });
    const txid = "ff".repeat(32);
    let seen = "";
    const fetchFn = (async (path: string, init?: RequestInit) => {
      seen = `${init?.method} ${path}`;
      return new Response(JSON.stringify({ txid }), { status: 200 });
    }) as GatewayFetch;
    expect(await broadcast(fetchFn, built.psbtBase64)).toEqual({ txid });
    expect(seen).toBe("POST /v1/btc/broadcast");
    await expect(broadcast(fetchFn, Buffer.from("junk").toString("base64"))).rejects.toThrow(/psbt magic/);
  });
});
