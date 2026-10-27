// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

/**
 * U040 — Address book + names.
 *
 * Contacts map a human name to per-chain addresses. Every entry records a
 * `firstSeen` timestamp (ms since epoch) per chain — the "first seen" trust
 * signal that approval UIs consume. Name resolution (ENS/SNS/ADA-handle)
 * happens through an injected async resolver so this module never touches
 * the network directly.
 */

// ---------------------------------------------------------------- schemas

export const ChainAddressSchema = z.object({
  chain: z.string().min(1),
  address: z.string().min(1),
  firstSeen: z.number().int().nonnegative(),
});
export type ChainAddress = z.infer<typeof ChainAddressSchema>;

export const ContactSchema = z.object({
  name: z.string().min(1).max(64),
  addresses: z.array(ChainAddressSchema),
});
export type Contact = z.infer<typeof ContactSchema>;

export const ContactBookExportSchema = z.object({
  version: z.literal(1),
  contacts: z.array(ContactSchema),
});
export type ContactBookExport = z.infer<typeof ContactBookExportSchema>;

export const NameKindSchema = z.enum(["ens", "sns", "ada-handle"]);
export type NameKind = z.infer<typeof NameKindSchema>;

/** Injected resolver: human name -> on-chain address (or null when unknown). */
export type NameResolverFn = (name: string, kind: NameKind) => Promise<string | null>;

export const TrustedCheckSchema = z.object({
  verdict: z.enum(["allow", "warn"]),
  code: z.string(),
  message: z.string(),
});
export type TrustedCheck = z.infer<typeof TrustedCheckSchema>;

// ---------------------------------------------------------------- helpers

function affixes(addr: string): { first4: string; last4: string } | null {
  const norm = addr.toLowerCase().replace(/^0x/, "");
  if (norm.length < 8) return null;
  return { first4: norm.slice(0, 4), last4: norm.slice(-4) };
}

/** Normalize a name for case-insensitive lookup. */
export function normalizeName(name: string): string {
  return z.string().min(1).parse(name).trim().toLowerCase();
}

// ---------------------------------------------------------------- book

export class ContactBook {
  private contacts = new Map<string, Contact>();

  /** Add (or update) a per-chain address for a contact. Records firstSeen once. */
  add(name: string, chain: string, address: string, nowMs?: number): Contact {
    const cleanName = z.string().min(1).max(64).parse(name.trim());
    const cleanChain = z.string().min(1).parse(chain);
    const cleanAddr = z.string().min(1).parse(address);
    const now = nowMs ?? Date.now();
    z.number().int().nonnegative().parse(now);

    const key = normalizeName(cleanName);
    const existing = this.contacts.get(key);
    if (!existing) {
      const contact: Contact = {
        name: cleanName,
        addresses: [{ chain: cleanChain, address: cleanAddr, firstSeen: now }],
      };
      this.contacts.set(key, ContactSchema.parse(contact));
      return contact;
    }
    const slot = existing.addresses.find((a) => a.chain === cleanChain);
    if (slot) {
      slot.address = cleanAddr; // keep original firstSeen on update
    } else {
      existing.addresses.push({ chain: cleanChain, address: cleanAddr, firstSeen: now });
    }
    return ContactSchema.parse(existing);
  }

  /** Resolve a contact name + chain to its address, or null. */
  resolve(name: string, chain: string): string | null {
    const contact = this.contacts.get(normalizeName(name));
    if (!contact) return null;
    return contact.addresses.find((a) => a.chain === chain)?.address ?? null;
  }

  /** Reverse lookup: address (+ optional chain) -> contact name, or null. */
  reverseLookup(address: string, chain?: string): string | null {
    const want = address.toLowerCase();
    for (const contact of this.contacts.values()) {
      for (const entry of contact.addresses) {
        if (chain !== undefined && entry.chain !== chain) continue;
        if (entry.address.toLowerCase() === want) return contact.name;
      }
    }
    return null;
  }

  /** All addresses ever seen (for poison-check history). */
  knownAddresses(chain?: string): string[] {
    const out: string[] = [];
    for (const contact of this.contacts.values()) {
      for (const entry of contact.addresses) {
        if (chain === undefined || entry.chain === chain) out.push(entry.address);
      }
    }
    return out;
  }

  list(): Contact[] {
    return [...this.contacts.values()].map((c) => ContactSchema.parse(c));
  }

  remove(name: string): boolean {
    return this.contacts.delete(normalizeName(name));
  }

  exportJSON(): string {
    const payload: ContactBookExport = {
      version: 1,
      contacts: this.list(),
    };
    return JSON.stringify(ContactBookExportSchema.parse(payload));
  }

  importJSON(json: string): Contact[] {
    const parsed = ContactBookExportSchema.parse(JSON.parse(json) as unknown);
    this.contacts.clear();
    for (const contact of parsed.contacts) {
      this.contacts.set(normalizeName(contact.name), contact);
    }
    return this.list();
  }
}

// ---------------------------------------------------------------- names

const ENS_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/i;
const SNS_RE = /^[a-z0-9-]+\.sol$/i;
const ADA_HANDLE_RE = /^\$[a-z0-9-_]{1,64}$/i;

/** Local format check before calling the injected resolver. */
export function isPlausibleName(name: string, kind: NameKind): boolean {
  NameKindSchema.parse(kind);
  if (kind === "ens") return ENS_RE.test(name);
  if (kind === "sns") return SNS_RE.test(name);
  return ADA_HANDLE_RE.test(name);
}

export interface ResolvedName {
  name: string;
  kind: NameKind;
  address: string | null;
}

/**
 * Resolve a human name via the injected resolver. Returns null address when
 * the format is implausible or the resolver knows nothing — never throws on
 * unknown names (throws only on invalid input / resolver failure).
 */
export async function resolveName(
  name: string,
  kind: NameKind,
  resolver: NameResolverFn,
): Promise<ResolvedName> {
  const clean = z.string().min(1).max(128).parse(name.trim());
  NameKindSchema.parse(kind);
  z.function().parse(resolver);
  if (!isPlausibleName(clean, kind)) return { name: clean, kind, address: null };
  const address = await resolver(clean, kind);
  if (address === null) return { name: clean, kind, address: null };
  return { name: clean, kind, address: z.string().min(1).parse(address) };
}

// ---------------------------------------------------------------- trust

/**
 * Poison-check a destination against the address book (mirrors the
 * policy-engine first4/last4 rule, with the book-aware UNSEEN code approval
 * UIs consume). Seen addresses pass; unseen addresses that collide
 * first4/last4 with any known address warn.
 */
export function trustedCheck(
  address: string,
  chain: string,
  book: ContactBook,
  extraHistory: string[] = [],
): TrustedCheck {
  const dest = z.string().min(1).parse(address);
  const cleanChain = z.string().min(1).parse(chain);
  z.array(z.string()).parse(extraHistory);
  if (!(book instanceof ContactBook)) throw new Error("book must be a ContactBook");

  const known = [...book.knownAddresses(cleanChain), ...extraHistory];
  const seen = known.some((h) => h.toLowerCase() === dest.toLowerCase());
  if (seen) {
    return TrustedCheckSchema.parse({
      verdict: "allow",
      code: "ADDRESS_SEEN",
      message: "destination is in the address book",
    });
  }
  const dAff = affixes(dest);
  if (dAff) {
    for (const h of known) {
      const hAff = affixes(h);
      if (hAff && hAff.first4 === dAff.first4 && hAff.last4 === dAff.last4) {
        return TrustedCheckSchema.parse({
          verdict: "warn",
          code: "ADDRESS_POISON_UNSEEN",
          message:
            "unseen address mimics a known address (first4/last4 collision) — verify the full address",
        });
      }
    }
  }
  return TrustedCheckSchema.parse({
    verdict: "warn",
    code: "ADDRESS_POISON_UNSEEN",
    message: "unseen address — not in the address book; verify before sending",
  });
}
