// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { isChainAllowed, isPathAllowed } from "./index.js";
import { createMockSigner } from "./mock.js";

describe("MockSigner", () => {
  it("roundtrips vault -> unlock -> derive -> lock", async () => {
    const signer = createMockSigner();
    const phrase = await signer.generateMnemonic(128);
    expect(await signer.validateMnemonic(phrase)).toBe(true);
    const vault = await signer.entropyToVault(phrase, "correct-horse-8!", true);
    expect(vault.version).toBe(1);
    const session = await signer.unlockVault(vault, "correct-horse-8!");
    const a = await signer.derivePubkey(session, "m/44'/60'/0'/0/0", "Secp256k1");
    const b = await signer.derivePubkey(session, "m/44'/60'/0'/0/0", "Secp256k1");
    expect(a).toEqual(b);
    expect(a.publicKeyHex.startsWith("02")).toBe(true);
    const evm = await signer.signEvm(session, {
      chainId: 1,
      nonce: 0,
      valueWei: "0",
      gasLimit: "21000",
      maxFeePerGasWei: "0",
      maxPriorityFeePerGasWei: "0",
      dataHex: "0x",
      path: "m/44'/60'/0'/0/0",
    });
    expect(evm.rawTxHex.startsWith("0x")).toBe(true);
    const sol = await signer.signSolana(session, {
      messageBytesHex: "00",
      path: "m/44'/501'/0'/0'",
    });
    expect(sol.signatureBase58.length).toBeGreaterThan(0);
    await signer.lock(session);
    await expect(signer.derivePubkey(session, "m/44'/60'/0'/0/0", "Secp256k1")).rejects.toThrow(
      /bad session/,
    );
  });

  it("wrong password fails", async () => {
    const signer = createMockSigner();
    const phrase = await signer.generateMnemonic(128);
    const vault = await signer.entropyToVault(phrase, "correct-horse-8!", true);
    await expect(signer.unlockVault(vault, "wrong")).rejects.toThrow(/wrong password/);
  });

  it("forbidden path/chain fails", async () => {
    const signer = createMockSigner();
    const phrase = await signer.generateMnemonic(256);
    const vault = await signer.entropyToVault(phrase, "pw", true);
    const session = await signer.unlockVault(vault, "pw");
    await expect(
      signer.derivePubkey(session, "m/44'/999'/0'/0/0", "Secp256k1"),
    ).rejects.toThrow(/forbidden/);
    await expect(
      signer.signEvm(session, {
        chainId: 999999,
        nonce: 0,
        valueWei: "0",
        gasLimit: "21000",
        maxFeePerGasWei: "0",
        maxPriorityFeePerGasWei: "0",
        dataHex: "0x",
        path: "m/44'/60'/0'/0/0",
      }),
    ).rejects.toThrow(/forbidden/);
    await signer.lock(session);
  });
});

describe("isPathAllowed parity with Rust allowlist", () => {
  it("matches derive.rs (44/60, 44/501, 84/0, 86/0, 1852/1815)", () => {
    expect(isPathAllowed("m/44'/60'/0'/0/0")).toBe(true);
    expect(isPathAllowed("m/44'/501'/0'/0'")).toBe(true);
    expect(isPathAllowed("m/84'/0'/0'/0/0")).toBe(true);
    expect(isPathAllowed("m/86'/0'/0'/0/0")).toBe(true);
    expect(isPathAllowed("m/1852'/1815'/0'/0/0")).toBe(true);
    expect(isPathAllowed("m/44'/999'/0'/0/0")).toBe(false);
    expect(isChainAllowed(1)).toBe(true);
    expect(isChainAllowed(999999)).toBe(false);
  });
});
