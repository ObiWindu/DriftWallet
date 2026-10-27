// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

/**
 * U044 — Accounts: HD wallet accounts, watch-only addresses, export.
 *
 * Derivation path formulas mirror the V1 `core` registry
 * (`m/44'/60'/0'/0/i`, `m/44'/501'/i'/0'`, `m/84'/0'/0'/0/i`,
 * `m/1852'/1815'/0'/0/i`) but are redeclared locally — this module takes no
 * cross-package imports. Seeds are NEVER present in these models; only
 * account metadata leaves the device.
 */

// ---------------------------------------------------------------- schemas

/** Local redeclaration of the V1 derivation path formulas (no import). */
export function derivationPath(chain: "evm" | "solana" | "bitcoin" | "cardano", index: number): string {
  z.number().int().nonnegative().max(2 ** 31 - 1).parse(index);
  switch (chain) {
    case "evm":
      return `m/44'/60'/0'/0/${index}`;
    case "solana":
      return `m/44'/501'/${index}'/0'`;
    case "bitcoin":
      return `m/84'/0'/0'/0/${index}`;
    case "cardano":
      return `m/1852'/1815'/0'/0/${index}`;
  }
}

export const HdAccountSchema = z.object({
  kind: z.literal("hd"),
  index: z.number().int().nonnegative(),
  name: z.string().min(1).max(64),
  paths: z.object({
    evm: z.string(),
    solana: z.string(),
    bitcoin: z.string(),
    cardano: z.string(),
  }),
});
export type HdAccount = z.infer<typeof HdAccountSchema>;

export const WatchOnlySchema = z.object({
  kind: z.literal("watch-only"),
  name: z.string().min(1).max(64),
  chain: z.string().min(1),
  address: z.string().min(1),
});
export type WatchOnly = z.infer<typeof WatchOnlySchema>;

export const AccountSchema = z.discriminatedUnion("kind", [HdAccountSchema, WatchOnlySchema]);
export type Account = z.infer<typeof AccountSchema>;

export const AccountListExportSchema = z.object({
  version: z.literal(1),
  exportedAt: z.number().int().nonnegative(),
  accounts: z.array(AccountSchema),
});
export type AccountListExport = z.infer<typeof AccountListExportSchema>;

// ---------------------------------------------------------------- builders

/** Create an HD account: index + name + all four derivation paths. */
export function createHdAccount(index: number, name?: string): HdAccount {
  const i = z.number().int().nonnegative().max(2 ** 31 - 1).parse(index);
  const label = name === undefined ? `Account ${i + 1}` : z.string().min(1).max(64).parse(name);
  return HdAccountSchema.parse({
    kind: "hd",
    index: i,
    name: label,
    paths: {
      evm: derivationPath("evm", i),
      solana: derivationPath("solana", i),
      bitcoin: derivationPath("bitcoin", i),
      cardano: derivationPath("cardano", i),
    },
  });
}

/** Register a watch-only address. No signer session exists for it. */
export function createWatchOnly(name: string, chain: string, address: string): WatchOnly {
  return WatchOnlySchema.parse({
    kind: "watch-only",
    name: z.string().min(1).max(64).parse(name),
    chain: z.string().min(1).parse(chain),
    address: z.string().min(1).parse(address),
  });
}

/** Rename any account (returns a new validated object). */
export function renameAccount(account: Account, name: string): Account {
  AccountSchema.parse(account);
  const clean = z.string().min(1).max(64).parse(name.trim());
  return AccountSchema.parse({ ...account, name: clean });
}

/**
 * Export the account list for backup/sync. Contains metadata ONLY —
 * no seeds, mnemonics, private keys, or entropy. Ever.
 */
export function exportAccountList(accounts: Account[], nowMs?: number): string {
  const list = z.array(AccountSchema).parse(accounts);
  const payload: AccountListExport = {
    version: 1,
    exportedAt: nowMs ?? Date.now(),
    accounts: list,
  };
  return JSON.stringify(AccountListExportSchema.parse(payload));
}

/** Re-import a previously exported account list. */
export function importAccountList(json: string): Account[] {
  const parsed = AccountListExportSchema.parse(JSON.parse(json) as unknown);
  return parsed.accounts;
}

/** True when the account can sign (HD); watch-only accounts cannot. */
export function canSign(account: Account): boolean {
  AccountSchema.parse(account);
  return account.kind === "hd";
}
