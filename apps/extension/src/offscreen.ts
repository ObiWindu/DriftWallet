// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// Offscreen doc: ONLY place loading signer WASM. Holds session in memory.
// Never writes to localStorage / chrome.storage. Background SW relays
// zod-validated messages here; this module validates again (defense in depth)
// then calls the injected SignerIface (WASM bindings in production).
import { z } from "zod";

export const OFFSCREEN_ONLY = "signer-wasm-lives-here";

export const OffscreenMsg = z.object({
  channel: z.literal("drift-v1"),
  kind: z.enum(["signEth", "signSolana", "signCardano", "signBtc", "lock"]),
  requestId: z.string().min(1),
  payload: z.unknown(),
});
export type OffscreenMsg = z.infer<typeof OffscreenMsg>;

export const OffscreenResult = z.object({
  requestId: z.string(),
  ok: z.boolean(),
  signature: z.string().optional(),
  error: z.string().optional(),
});
export type OffscreenResult = z.infer<typeof OffscreenResult>;

/** Minimal signer surface the WASM bindings must satisfy. */
export interface SignerIface {
  signEth(payload: unknown, session: object): Promise<string>;
  signSolana(payload: unknown, session: object): Promise<string>;
  signCardano(payload: unknown, session: object): Promise<string>;
  signBtc(payload: unknown, session: object): Promise<string>;
}

/** In-memory session handle. Module-scoped, never persisted. */
let sessionHandle: object | null = null;

export function setSessionForTests(handle: object | null): void {
  sessionHandle = handle;
}

export function hasSession(): boolean {
  return sessionHandle !== null;
}

export function lockSession(): void {
  sessionHandle = null;
}

export async function handleOffscreenMessage(
  raw: unknown,
  signer: SignerIface,
): Promise<OffscreenResult> {
  const msg = OffscreenMsg.parse(raw);
  if (msg.kind === "lock") {
    lockSession();
    return { requestId: msg.requestId, ok: true };
  }
  if (sessionHandle === null) {
    return { requestId: msg.requestId, ok: false, error: "locked" };
  }
  try {
    let signature: string;
    switch (msg.kind) {
      case "signEth":
        signature = await signer.signEth(msg.payload, sessionHandle);
        break;
      case "signSolana":
        signature = await signer.signSolana(msg.payload, sessionHandle);
        break;
      case "signCardano":
        signature = await signer.signCardano(msg.payload, sessionHandle);
        break;
      case "signBtc":
        signature = await signer.signBtc(msg.payload, sessionHandle);
        break;
    }
    return { requestId: msg.requestId, ok: true, signature };
  } catch (err) {
    return { requestId: msg.requestId, ok: false, error: err instanceof Error ? err.message : "sign-failed" };
  }
}
