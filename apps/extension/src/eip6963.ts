// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// U023 EIP-6963 multi-provider discovery helper (extension-local).
// Builds the announce payload our injected shim emits and parses
// announcements from other wallets. No window access — the content-script
// wires these to real CustomEvents ("eip6963:announceProvider" /
// "eip6963:requestProvider").
import { z } from "zod";

export const EIP6963_ANNOUNCE_EVENT = "eip6963:announceProvider";
export const EIP6963_REQUEST_EVENT = "eip6963:requestProvider";

export const ProviderInfo = z.object({
  uuid: z.string().min(1),
  name: z.string().min(1).max(60),
  icon: z.string().startsWith("data:image/"),
  rdns: z.string().regex(/^[a-z0-9]+(\.[a-z0-9-]+)+$/i),
});
export type ProviderInfo = z.infer<typeof ProviderInfo>;

export const DRIFT_RDNS = "wallet.drift";

export interface AnnounceMessage {
  type: typeof EIP6963_ANNOUNCE_EVENT;
  detail: { info: ProviderInfo; providerRef: string };
}

/**
 * Build our announce payload. `providerRef` names the live EIP-1193 object
 * the shim attaches (e.g. "window.ethereum"); the event itself is
 * dispatched by the content-script, which holds the real provider.
 */
export function buildAnnounce(info: unknown, providerRef = "window.ethereum"): AnnounceMessage {
  const parsed = ProviderInfo.parse(info);
  const ref = z.string().min(1).parse(providerRef);
  return { type: EIP6963_ANNOUNCE_EVENT, detail: { info: parsed, providerRef: ref } };
}

/** Event listener payload to dispatch when probing for other wallets. */
export function buildRequestProvider(): { type: typeof EIP6963_REQUEST_EVENT } {
  return { type: EIP6963_REQUEST_EVENT };
}

/** Guard for raw window events claiming to be EIP-6963 announcements. */
export function isAnnounceMessage(raw: unknown): raw is AnnounceMessage {
  return z
    .object({ type: z.literal(EIP6963_ANNOUNCE_EVENT), detail: z.object({ info: ProviderInfo }) })
    .safeParse(raw).success;
}

/** Parse a peer announcement; null when it is not a well-formed one. */
export function parseAnnounce(raw: unknown): ProviderInfo | null {
  const parsed = z
    .object({ type: z.literal(EIP6963_ANNOUNCE_EVENT), detail: z.object({ info: ProviderInfo }) })
    .safeParse(raw);
  return parsed.success ? parsed.data.detail.info : null;
}

/** Our own provider info (uuid assigned per install by the shell). */
export function driftProviderInfo(installUuid: string): ProviderInfo {
  return ProviderInfo.parse({
    uuid: z.string().min(1).parse(installUuid),
    name: "DriftWallet",
    icon: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    rdns: DRIFT_RDNS,
  });
}
