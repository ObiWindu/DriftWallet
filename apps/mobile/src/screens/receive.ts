// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

// Receive screen view-model (U013 numbering: receive = U012 pair of send).
// Shapes an address + chain into QR payload, share text, and truncated
// display. Seed/secret never appears here (receive shows only the address),
// but screens still set FLAG_SECURE per `secure.ts` checklist.

export const ReceiveInputSchema = z.object({
  address: z.string().min(1).max(256),
  chainId: z.string().min(1).max(128),
});

/** Middle-truncate mirror of the ui helper (local: no cross-package imports). */
export function truncateMiddle(addr: string, chars = 4): string {
  const a = z.string().parse(addr);
  const c = z.number().int().min(1).parse(chars);
  if (a.length <= c * 2 + 3) return a;
  return `${a.slice(0, c + (a.startsWith("0x") ? 2 : 0))}…${a.slice(-c)}`;
}

export interface ReceiveState {
  titleKey: "receive.title";
  qrPayload: string;
  truncated: string;
  shareText: string;
  copyKey: "receive.copyAddress";
  shareKey: "receive.share";
  flagSecure: true;
}

export function receiveState(input: { address: string; chainId: string }): ReceiveState {
  const { address, chainId } = ReceiveInputSchema.parse(input);
  void chainId;
  return {
    titleKey: "receive.title",
    qrPayload: address,
    truncated: truncateMiddle(address),
    shareText: address,
    copyKey: "receive.copyAddress",
    shareKey: "receive.share",
    flagSecure: true,
  };
}
