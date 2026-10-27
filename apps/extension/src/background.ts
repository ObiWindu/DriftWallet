// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// MV3 background (service worker): session + permission store. No keys.
// Offscreen doc holds WASM signer session; content-script injects EIP-1193/CIP-30.
import { z } from "zod";

export const RpcMsg = z.object({
  channel: z.literal("drift-v1"),
  method: z.enum(["eth_requestAccounts", "eth_sendTransaction", "eth_signTypedData_v4", "solana_signTransaction", "cardano_signTx"]),
  origin: z.string().url(),
  payload: z.unknown(),
});
export type RpcMsg = z.infer<typeof RpcMsg>;

export const MANIFEST_PERMISSIONS = ["storage", "alarms", "offscreen", "activeTab"] as const;
const FORBIDDEN = ["<all_urls>", "tabs", "webRequestBlocking", "debugger"];

export function reviewManifest(manifest: { permissions?: string[]; content_security_policy?: unknown; content_scripts?: unknown[] }): string[] {
  const errors: string[] = [];
  for (const p of manifest.permissions ?? []) {
    if ((FORBIDDEN as readonly string[]).includes(p)) errors.push(`forbidden permission: ${p}`);
  }
  if (manifest.content_scripts?.some((cs: unknown) => JSON.stringify(cs).includes("<all_urls>"))) {
    errors.push("content_scripts must not use <all_urls>");
  }
  return errors;
}

export const CSP_REQUIRED = "script-src 'self'; object-src 'none'; connect-src https://gateway.drift.example";
