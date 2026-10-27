// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { ContactBook, isPlausibleName, resolveName, trustedCheck } from "./address-book.js";

describe("address-book", () => {
  it("adds/resolves per-chain addresses with firstSeen timestamps", () => {
    const book = new ContactBook();
    const t0 = 1_700_000_000_000;
    book.add("Alice", "eip155:1", "0x1111111111111111111111111111111111111111", t0);
    book.add("Alice", "solana:mainnet", "AliceSol1111111111111111111111111111111", t0 + 1000);
    expect(book.resolve("alice", "eip155:1")).toBe("0x1111111111111111111111111111111111111111");
    expect(book.resolve("ALICE", "solana:mainnet")).toBe("AliceSol1111111111111111111111111111111");
    expect(book.resolve("alice", "cardano:mainnet")).toBeNull();
    expect(book.resolve("bob", "eip155:1")).toBeNull();
    // updating the address keeps the original firstSeen
    book.add("Alice", "eip155:1", "0x2222222222222222222222222222222222222222", t0 + 5000);
    const contact = book.list().find((c) => c.name === "Alice");
    expect(contact?.addresses.find((a) => a.chain === "eip155:1")?.firstSeen).toBe(t0);
  });

  it("exports/imports JSON with zod validation", () => {
    const book = new ContactBook();
    book.add("Alice", "eip155:1", "0x1111111111111111111111111111111111111111", 1000);
    const json = book.exportJSON();
    const book2 = new ContactBook();
    const contacts = book2.importJSON(json);
    expect(contacts).toHaveLength(1);
    expect(book2.resolve("Alice", "eip155:1")).toBe("0x1111111111111111111111111111111111111111");
    expect(() => book2.importJSON(`{"version":2,"contacts":[]}`)).toThrow();
    expect(() => book2.importJSON(`{"contacts":"nope"}`)).toThrow();
    expect(() => book2.importJSON(`not json`)).toThrow();
  });

  it("resolves names via the injected resolver only", async () => {
    const calls: Array<[string, string]> = [];
    const resolver = async (name: string, kind: string): Promise<string | null> => {
      calls.push([name, kind]);
      if (name === "alice.eth") return "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      return null;
    };
    const hit = await resolveName("alice.eth", "ens", resolver);
    expect(hit.address).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const miss = await resolveName("nobody.eth", "ens", resolver);
    expect(miss.address).toBeNull();
    // implausible format never reaches the resolver (no network)
    const bad = await resolveName("not a name!!!", "ens", resolver);
    expect(bad.address).toBeNull();
    expect(calls).toHaveLength(2);
    expect(isPlausibleName("alice.eth", "ens")).toBe(true);
    expect(isPlausibleName("bob.sol", "sns")).toBe(true);
    expect(isPlausibleName("$adahandle", "ada-handle")).toBe(true);
    expect(isPlausibleName("alice.eth", "sns")).toBe(false);
  });

  it("trustedCheck allows seen, warns unseen collisions", () => {
    const book = new ContactBook();
    const legit = "0x1234567890abcdef1234567890abcdef12345678";
    const poison = "0x1234ffffffffffeeeeeeeeeeeeeeeeeeeeeeee5678";
    book.add("Legit", "eip155:1", legit, 1000);
    expect(trustedCheck(legit, "eip155:1", book).verdict).toBe("allow");
    const warn = trustedCheck(poison, "eip155:1", book);
    expect(warn.verdict).toBe("warn");
    expect(warn.code).toBe("ADDRESS_POISON_UNSEEN");
    const fresh = trustedCheck("0x9999aaaa0000bbbb11112222333344445555cccc", "eip155:1", book);
    expect(fresh.code).toBe("ADDRESS_POISON_UNSEEN");
    // history-only knowledge also triggers the collision warning
    const empty = new ContactBook();
    expect(trustedCheck(poison, "eip155:1", empty, [legit]).code).toBe("ADDRESS_POISON_UNSEEN");
  });
});
