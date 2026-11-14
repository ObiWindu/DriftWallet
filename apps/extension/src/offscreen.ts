// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// Offscreen doc: ONLY place loading signer WASM. Holds session in memory.
// Never writes to localStorage / chrome.storage. Background SW relays
// zod-validated messages here; this module validates again (defense in depth)
// then calls the injected SignerIface (WASM bindings in production).
import { z } from "zod";

export const OFFSCREEN_ONLY = "signer-wasm-lives-here";

const HexRe = /^(0x)?[0-9a-fA-F]*$/;
const DecRe = /^\d+$/;

export const UnlockPayload = z.object({
  vault: z.object({ version: z.literal(1) }).passthrough(),
  password: z.string().min(1),
});

export const SignEthPayload = z.object({
  chainId: z.number().int().positive(),
  to: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  valueWei: z.string().regex(DecRe),
  nonce: z.number().int().nonnegative(),
  gasLimit: z.string().regex(DecRe),
  maxFeePerGasWei: z.string().regex(DecRe),
  maxPriorityFeePerGasWei: z.string().regex(DecRe),
  dataHex: z.string().regex(/^0x[0-9a-fA-F]*$/),
  path: z.string().min(1),
  typedDataHashHex: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
});

export const SignSolanaPayload = z.object({
  messageBytesHex: z.string().regex(HexRe),
  path: z.string().min(1),
});

export const SignBtcPayload = z.object({
  inputs: z.array(z.object({ sighashHex: z.string().regex(HexRe), path: z.string().min(1) })),
  psbtBase64: z.string().min(1),
  feeSats: z.string().regex(DecRe),
  totalInSats: z.string().regex(DecRe),
  totalOutSats: z.string().regex(DecRe),
  allowHighFee: z.boolean(),
});

export const SignCardanoPayload = z.object({
  txBodyCborHex: z.string().regex(HexRe),
  witnessPaths: z.array(z.string().min(1)),
});

export const OffscreenMsg = z.object({
  channel: z.literal("drift-v1"),
  kind: z.enum(["unlock", "signEth", "signSolana", "signCardano", "signBtc", "lock"]),
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
  /** Unlock an encrypted vault; resolves to an opaque session handle. */
  unlockVault(payload: z.infer<typeof UnlockPayload>): Promise<object>;
  /** Drop the session inside the signer (Rust zeroizes key material). */
  lockSession(session: object): Promise<void>;
  signEth(payload: z.infer<typeof SignEthPayload>, session: object): Promise<string>;
  signSolana(payload: z.infer<typeof SignSolanaPayload>, session: object): Promise<string>;
  signCardano(payload: z.infer<typeof SignCardanoPayload>, session: object): Promise<string>;
  signBtc(payload: z.infer<typeof SignBtcPayload>, session: object): Promise<string>;
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
    try {
      if (sessionHandle !== null) await signer.lockSession(sessionHandle);
    } finally {
      lockSession();
    }
    return { requestId: msg.requestId, ok: true };
  }
  if (msg.kind === "unlock") {
    try {
      const payload = UnlockPayload.parse(msg.payload);
      sessionHandle = await signer.unlockVault(payload);
      return { requestId: msg.requestId, ok: true };
    } catch (err) {
      lockSession();
      return { requestId: msg.requestId, ok: false, error: err instanceof Error ? err.message : "unlock-failed" };
    }
  }
  if (sessionHandle === null) {
    return { requestId: msg.requestId, ok: false, error: "locked" };
  }
  try {
    let signature: string;
    switch (msg.kind) {
      case "signEth":
        signature = await signer.signEth(SignEthPayload.parse(msg.payload), sessionHandle);
        break;
      case "signSolana":
        signature = await signer.signSolana(SignSolanaPayload.parse(msg.payload), sessionHandle);
        break;
      case "signCardano":
        signature = await signer.signCardano(SignCardanoPayload.parse(msg.payload), sessionHandle);
        break;
      case "signBtc":
        signature = await signer.signBtc(SignBtcPayload.parse(msg.payload), sessionHandle);
        break;
    }
    return { requestId: msg.requestId, ok: true, signature };
  } catch (err) {
    return { requestId: msg.requestId, ok: false, error: err instanceof Error ? err.message : "sign-failed" };
  }
}
