// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  canSign,
  createHdAccount,
  createWatchOnly,
  derivationPath,
  exportAccountList,
  importAccountList,
  renameAccount,
} from "./accounts.js";

describe("accounts", () => {
  it("creates HD accounts with V1 derivation paths", () => {
    expect(derivationPath("evm", 0)).toBe("m/44'/60'/0'/0/0");
    expect(derivationPath("evm", 5)).toBe("m/44'/60'/0'/0/5");
    expect(derivationPath("solana", 2)).toBe("m/44'/501'/2'/0'");
    expect(derivationPath("bitcoin", 0)).toBe("m/84'/0'/0'/0/0");
    expect(derivationPath("cardano", 1)).toBe("m/1852'/1815'/0'/0/1");
    const acc = createHdAccount(0);
    expect(acc.name).toBe("Account 1");
    expect(acc.paths.evm).toBe("m/44'/60'/0'/0/0");
    expect(createHdAccount(3, "Savings").name).toBe("Savings");
    expect(canSign(acc)).toBe(true);
  });

  it("creates watch-only entries and renames accounts", () => {
    const w = createWatchOnly("Cold vault", "eip155:1", "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(w.kind).toBe("watch-only");
    expect(canSign(w)).toBe(false);
    const renamed = renameAccount(w, "Deep cold vault");
    expect(renamed.name).toBe("Deep cold vault");
    expect(renameAccount(createHdAccount(0), "  Daily  ").name).toBe("Daily");
    expect(() => renameAccount(w, "")).toThrow();
    expect(() => createWatchOnly("x", "eip155:1", "")).toThrow();
  });

  it("export never includes seeds (scanned for mnemonic-like words)", () => {
    const accounts = [
      createHdAccount(0, "Main"),
      createHdAccount(1, "Savings"),
      createWatchOnly("Vault", "eip155:1", "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    ];
    const json = exportAccountList(accounts, 1_700_000_000_000);
    // Round-trips through the zod schema.
    expect(importAccountList(json)).toHaveLength(3);
    // Scan for BIP39-ish / secret material. None of the classic test-vector
    // mnemonic words may appear anywhere in the export.
    const mnemonicWords = [
      "abandon", "ability", "about", "above", "absent", "absorb", "abstract", "absurd",
      "abuse", "access", "accident", "accuse", "achieve", "acid",
      "stomach", "stone", "story", "stove", "strategy", "street", "strike",
      "zoo", "zero", "yellow", "youth", "vapor", "valley", "trophy", "trend",
    ];
    const lower = json.toLowerCase();
    for (const word of mnemonicWords) {
      expect(new RegExp(`\\b${word}\\b`).test(lower)).toBe(false);
    }
    expect(lower).not.toContain("mnemonic");
    expect(lower).not.toContain("seed");
    expect(lower).not.toContain("entropy");
    expect(lower).not.toContain("privatekey");
    expect(lower).not.toContain("private-key");
    expect(() => importAccountList(`{"version":2,"exportedAt":0,"accounts":[]}`)).toThrow();
  });
});
