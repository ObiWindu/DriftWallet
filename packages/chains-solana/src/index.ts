// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

export const SolanaTransfer = z.object({
  fromBase58: z.string().min(32),
  toBase58: z.string().min(32),
  lamports: z.string().regex(/^\d+$/),
  recentBlockhash: z.string().min(1),
  derivationPath: z.string().default("m/44'/501'/0'/0'"),
});
export type SolanaTransfer = z.infer<typeof SolanaTransfer>;

export function buildSolanaMessage(req: z.input<typeof SolanaTransfer>): { messageHex: string; feeLamports: string } {
  const p = SolanaTransfer.parse(req);
  // V1: deterministic message framing for signer (real tx compilation happens
  // against @solana/kit in apps; signer signs raw message bytes).
  const body = `sol:${p.fromBase58}>${p.toBase58}:${p.lamports}@${p.recentBlockhash}`;
  return { messageHex: Buffer.from(body, "utf8").toString("hex"), feeLamports: "5000" };
}

export function validateSolanaAddress(a: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
}

// ---------------------------------------------------------------------------
// T006: SPL transfers, fee tiers, gateway-backed reads/broadcast (DI only)
// ---------------------------------------------------------------------------

const Base58Addr = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const UintStr = z.string().regex(/^\d+$/);

export const SplTransferInput = z.object({
  fromBase58: Base58Addr,
  /** Destination token account (ATA) or owner; resolved off-chain by apps. */
  toTokenAccountBase58: Base58Addr,
  mintBase58: Base58Addr,
  amountBaseUnits: UintStr,
  decimals: z.number().int().min(0).max(18),
  recentBlockhash: z.string().min(1),
  derivationPath: z.string().default("m/44'/501'/0'/0'"),
});
export type SplTransferInput = z.infer<typeof SplTransferInput>;

/**
 * Deterministic SPL transferChecked framing for the signer.
 * Real instruction compilation (transferChecked + ATA derivation) happens
 * against @solana/kit in apps; the signer signs raw message bytes.
 */
export function buildSplTransfer(req: z.input<typeof SplTransferInput>): {
  messageHex: string;
  feeLamports: string;
  mint: string;
} {
  const p = SplTransferInput.parse(req);
  const body = `spl:${p.fromBase58}>${p.toTokenAccountBase58}:${p.mintBase58}:${p.amountBaseUnits}:${p.decimals}@${p.recentBlockhash}`;
  return { messageHex: Buffer.from(body, "utf8").toString("hex"), feeLamports: "5000", mint: p.mintBase58 };
}

/** Priority fee tiers in lamports (base 5000 + compute-unit price ladders). */
export function solanaFeeTiers(): { low: bigint; med: bigint; high: bigint } {
  return { low: 5000n, med: 15000n, high: 50000n };
}

export function estimateSolFee(priority: "low" | "med" | "high"): bigint {
  return solanaFeeTiers()[priority];
}

/** Injected gateway transport. Never call global fetch directly (keeps tests hermetic). */
export type GatewayFetch = (path: string, init?: RequestInit) => Promise<Response>;

const BalanceResp = z.object({ lamports: UintStr });
const TokenAccountsResp = z.object({
  accounts: z.array(
    z.object({ pubkey: Base58Addr, mint: Base58Addr, amountBaseUnits: UintStr, decimals: z.number().int() }),
  ),
});
const BroadcastResp = z.object({ txSig: z.string().min(1) });

async function readJson(fetchFn: GatewayFetch, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetchFn(path, init);
  if (!res.ok) throw new Error(`gateway ${res.status} for ${path}`);
  return (await res.json()) as unknown;
}

export async function getBalance(fetchFn: GatewayFetch, address: string): Promise<{ lamports: bigint }> {
  Base58Addr.parse(address);
  const body = BalanceResp.parse(await readJson(fetchFn, `/v1/sol/balance/${address}`));
  return { lamports: BigInt(body.lamports) };
}

export async function getTokenAccounts(
  fetchFn: GatewayFetch,
  owner: string,
): Promise<Array<{ pubkey: string; mint: string; amountBaseUnits: bigint; decimals: number }>> {
  Base58Addr.parse(owner);
  const body = TokenAccountsResp.parse(await readJson(fetchFn, `/v1/sol/tokens/${owner}`));
  return body.accounts.map((a) => ({ ...a, amountBaseUnits: BigInt(a.amountBaseUnits) }));
}

export async function broadcast(fetchFn: GatewayFetch, signedTxBase64: string): Promise<{ txSig: string }> {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signedTxBase64) || signedTxBase64.length < 8) {
    throw new Error("bad signed bytes");
  }
  // Must decode as base64.
  const raw = Buffer.from(signedTxBase64, "base64");
  if (raw.length === 0) throw new Error("bad signed bytes");
  const body = BroadcastResp.parse(
    await readJson(fetchFn, `/v1/sol/broadcast`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rawTx: signedTxBase64 }),
    }),
  );
  return { txSig: body.txSig };
}
