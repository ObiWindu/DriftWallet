// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// U023 Solana wallet-standard connect/sign model (extension-local).
// Session lifecycle (connect/disconnect) + sign descriptors that feed the
// approval queue. No key material, no network — the background SW owns both.
import { z } from "zod";

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

export const SolanaChains = z.array(z.string().startsWith("solana:")).min(1).default(["solana:mainnet"]);
export const SolanaFeatures = z
  .array(z.enum(["solana:signTransaction", "solana:signMessage", "solana:signAndSendTransaction"]))
  .default(["solana:signTransaction", "solana:signMessage"]);

export const SolanaSession = z.object({
  address: Base58,
  chains: SolanaChains,
  features: SolanaFeatures,
  connectedAt: z.number().int().nonnegative(),
});
export type SolanaSession = z.infer<typeof SolanaSession>;

export interface SolanaSignDescriptor {
  method: "solana_signTransaction";
  address: string;
  payload: { txBase64: string } | { messageUtf8: string };
}

/** Connect: first account wins; empty lists and garbage addresses rejected. */
export function solanaConnect(rawAccounts: unknown, connectedAt: number): SolanaSession {
  const accounts = z.array(Base58).min(1).parse(rawAccounts);
  const at = z.number().int().nonnegative().parse(connectedAt);
  const address = accounts[0] as string;
  return SolanaSession.parse({ address, chains: ["solana:mainnet"], features: undefined, connectedAt: at });
}

const Base64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/);

/** Sign-transaction descriptor for the approval queue. */
export function solanaSignTransaction(session: SolanaSession, txBase64: unknown): SolanaSignDescriptor {
  const s = SolanaSession.parse(session);
  const tx = Base64.parse(txBase64);
  if (tx.length < 8) throw new Error("tx bytes too short");
  if (!s.features.includes("solana:signTransaction")) throw new Error("feature not granted: signTransaction");
  return { method: "solana_signTransaction", address: s.address, payload: { txBase64: tx } };
}

/** Sign-message descriptor for the approval queue. */
export function solanaSignMessage(session: SolanaSession, messageUtf8: unknown): SolanaSignDescriptor {
  const s = SolanaSession.parse(session);
  const message = z.string().min(1).max(4096).parse(messageUtf8);
  if (!s.features.includes("solana:signMessage")) throw new Error("feature not granted: signMessage");
  return { method: "solana_signTransaction", address: s.address, payload: { messageUtf8: message } };
}

/** Disconnect: session handle dropped; the shell clears the badge. */
export function solanaDisconnect(session: SolanaSession): null {
  SolanaSession.parse(session);
  return null;
}
