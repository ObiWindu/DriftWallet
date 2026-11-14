// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadWasmSigner } from "./wasm.js";

const gluePath = fileURLToPath(new URL("../wasm-pkg/drift_signer.js", import.meta.url));
const wasmPkgBuilt = fs.existsSync(gluePath);

describe("loadWasmSigner (extension offscreen)", () => {
  it("throws a helpful error when wasm-pkg is not built", async () => {
    if (wasmPkgBuilt) return; // covered by the roundtrip test below
    await expect(loadWasmSigner()).rejects.toThrow(/wasm-pack|wasm-pkg|missing/i);
  });

  it("runs a real sign roundtrip against the built wasm artifact", async () => {
    if (!wasmPkgBuilt) return; // covered by the missing-artifact test above
    const signer = await loadWasmSigner();

    const phrase = await signer.generateMnemonic(128);
    expect(phrase.trim().split(/\s+/)).toHaveLength(12);
    await expect(signer.validateMnemonic(phrase)).resolves.toBe(true);
    await expect(signer.validateMnemonic("not a real phrase")).resolves.toBe(false);

    const vault = await signer.entropyToVault(phrase, "test-password-123", true);
    expect(vault.version).toBe(1);
    await expect(signer.unlockVault(vault, "wrong-password")).rejects.toThrow();

    const session = await signer.unlockVault(vault, "test-password-123");
    const pub = await signer.derivePubkey(session, "m/44'/60'/0'/0/0", "Secp256k1");
    expect(pub.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(pub.publicKeyHex).toMatch(/^(0x)?[0-9a-fA-F]+$/);

    const evm = await signer.signEvm(session, {
      chainId: 1,
      to: "0x0000000000000000000000000000000000000001",
      valueWei: "1000000000000000",
      nonce: 0,
      gasLimit: "21000",
      maxFeePerGasWei: "1000000000",
      maxPriorityFeePerGasWei: "1000000000",
      dataHex: "0x",
      path: "m/44'/60'/0'/0/0",
    });
    expect(evm.rawTxHex).toMatch(/^0x02[0-9a-fA-F]+$/);
    expect(evm.txHashHex).toMatch(/^0x[0-9a-fA-F]{64}$/);

    const sol = await signer.signSolana(session, {
      messageBytesHex: "0xdeadbeef",
      path: "m/44'/501'/0'/0'",
    });
    expect(sol.signatureBase58.length).toBeGreaterThan(60);
    expect(sol.publicKeyBase58.length).toBeGreaterThan(30);

    // Forbidden paths/chains are rejected (TS-side; Rust re-validates).
    await expect(signer.derivePubkey(session, "m/44'/0'/0'", "Secp256k1")).rejects.toThrow(/path/i);
    await expect(
      signer.signEvm(session, {
        chainId: 999999,
        valueWei: "0",
        nonce: 0,
        gasLimit: "21000",
        maxFeePerGasWei: "1",
        maxPriorityFeePerGasWei: "1",
        dataHex: "0x",
        path: "m/44'/60'/0'/0/0",
      }),
    ).rejects.toThrow(/chain/i);

    await signer.lock(session);
    await expect(
      signer.derivePubkey(session, "m/44'/60'/0'/0/0", "Secp256k1"),
    ).rejects.toThrow();
  });
});
