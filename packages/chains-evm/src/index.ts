// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

export const EvmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const Hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const HexStrict = z.string().regex(/^0x[0-9a-fA-F]+$/);
const UintStr = z.string().regex(/^\d+$/);

export const TransferInput = z.object({
  chainId: z.number().int(),
  from: EvmAddress,
  to: EvmAddress,
  amountWei: z.string().regex(/^\d+$/),
  nonce: z.number().int().nonnegative(),
  gasLimit: z.string().regex(/^\d+$/),
  maxFeePerGasWei: z.string().regex(/^\d+$/),
  maxPriorityFeePerGasWei: z.string().regex(/^\d+$/),
  dataHex: z.string().regex(/^0x[0-9a-fA-F]*$/).default("0x"),
  derivationPath: z.string().default("m/44'/60'/0'/0/0"),
});
export type TransferInput = z.infer<typeof TransferInput>;

const ALLOWED = new Set([1, 56, 137, 42161, 8453, 11155111, 97, 80002, 421614, 84532]);

function u256ToBytes32(dec: string): string {
  const v = BigInt(dec);
  if (v < 0n || v >= 1n << 256n) throw new Error("u256 out of range");
  return v.toString(16).padStart(64, "0");
}

export function buildEvmSignerRequest(input: z.input<typeof TransferInput>) {
  const parsed = TransferInput.parse(input);
  if (!ALLOWED.has(parsed.chainId)) throw new Error(`forbidden chain ${parsed.chainId}`);
  const to20 = parsed.to.toLowerCase().slice(2);
  return {
    chain_id: parsed.chainId,
    to: to20,
    value_wei_hex: u256ToBytes32(parsed.amountWei),
    nonce: parsed.nonce,
    gas_limit: parsed.gasLimit,
    max_fee_hex: u256ToBytes32(parsed.maxFeePerGasWei),
    max_priority_hex: u256ToBytes32(parsed.maxPriorityFeePerGasWei),
    data_hex: parsed.dataHex,
    path: parsed.derivationPath,
  };
}

export function erc20TransferData(to: string, amountWei: string): `0x${string}` {
  EvmAddress.parse(to);
  const amt = u256ToBytes32(amountWei);
  const addr = to.toLowerCase().slice(2).padStart(64, "0");
  return `0xa9059cbb${addr}${amt}`;
}

export function estimateFee(gasLimit: string, maxFeePerGasWei: string): bigint {
  return BigInt(gasLimit) * BigInt(maxFeePerGasWei);
}

// ---------------------------------------------------------------------------
// T006: tokens, fee tiers, gateway-backed adapter (no direct fetch — DI only)
// ---------------------------------------------------------------------------

export interface EvmTokenMeta {
  symbol: "USDC" | "USDT" | "WETH";
  address: `0x${string}`;
  decimals: number;
}

/** Canonical allowlist per chain (checksum addresses). User custom tokens bypass via buildTokenTransfer. */
export const EVM_TOKENS: Record<number, EvmTokenMeta[]> = {
  1: [
    { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
    { symbol: "WETH", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
  ],
  56: [
    { symbol: "USDC", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
    { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
    { symbol: "WETH", address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", decimals: 18 },
  ],
  137: [
    { symbol: "USDC", address: "0x2791bCa1f2de4661eD88a30c119A2dEbcF2f3837", decimals: 6 },
    { symbol: "USDT", address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
    { symbol: "WETH", address: "0x7CEb23fD6bc0adD59E62Ac25578270cf1b9f619C", decimals: 18 },
  ],
  42161: [
    { symbol: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
    { symbol: "USDT", address: "0xFD086bc7cD5c4815adaE9B83DBE69B30ccb055BF", decimals: 6 },
    { symbol: "WETH", address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18 },
  ],
  8453: [
    { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    { symbol: "USDT", address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6 },
    { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
  ],
};

export function isAllowedToken(chainId: number, token: string): boolean {
  const list = EVM_TOKENS[chainId];
  if (!list) return false;
  const lower = token.toLowerCase();
  return list.some((t) => t.address.toLowerCase() === lower);
}

export const TokenTransferInput = z.object({
  chainId: z.number().int(),
  from: EvmAddress,
  token: EvmAddress,
  to: EvmAddress,
  amountBaseUnits: UintStr,
  nonce: z.number().int().nonnegative(),
  gasLimit: UintStr,
  maxFeePerGasWei: UintStr,
  maxPriorityFeePerGasWei: UintStr,
  derivationPath: z.string().default("m/44'/60'/0'/0/0"),
});
export type TokenTransferInput = z.infer<typeof TokenTransferInput>;

/** ERC-20 transfer framed as a signer request (token contract as `to`, zero value, calldata). */
export function buildTokenTransfer(input: z.input<typeof TokenTransferInput>) {
  const p = TokenTransferInput.parse(input);
  if (!ALLOWED.has(p.chainId)) throw new Error(`forbidden chain ${p.chainId}`);
  const dataHex = erc20TransferData(p.to, p.amountBaseUnits);
  return {
    chain_id: p.chainId,
    to: p.token.toLowerCase().slice(2),
    token: p.token,
    value_wei_hex: "0".repeat(64),
    nonce: p.nonce,
    gas_limit: p.gasLimit,
    max_fee_hex: u256ToBytes32(p.maxFeePerGasWei),
    max_priority_hex: u256ToBytes32(p.maxPriorityFeePerGasWei),
    data_hex: dataHex,
    path: p.derivationPath,
  };
}

export interface EvmFeeTiers {
  low: string;
  med: string;
  high: string;
}

/** Detailed fee estimate: gasLimit × per-tier maxFeePerGas. All bigint. */
export function estimateFeeDetailed(
  gasLimit: string,
  maxFeesWei: EvmFeeTiers,
): { low: bigint; med: bigint; high: bigint } {
  const tiers = z.object({ low: UintStr, med: UintStr, high: UintStr }).parse(maxFeesWei);
  UintStr.parse(gasLimit);
  const g = BigInt(gasLimit);
  const out = { low: g * BigInt(tiers.low), med: g * BigInt(tiers.med), high: g * BigInt(tiers.high) };
  if (!(out.low <= out.med && out.med <= out.high)) throw new Error("fee tiers unordered");
  return out;
}

/** Injected gateway transport. Never call global fetch directly (keeps tests hermetic). */
export type GatewayFetch = (path: string, init?: RequestInit) => Promise<Response>;

const BalanceResp = z.object({ balanceWei: UintStr });
const HistoryResp = z.object({
  txs: z.array(
    z.object({ hash: HexStrict, to: z.string(), valueWei: UintStr, blockNumber: z.string().optional() }),
  ),
  nextCursor: z.string().optional(),
});
const BroadcastResp = z.object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) });

async function readJson(fetchFn: GatewayFetch, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetchFn(path, init);
  if (!res.ok) throw new Error(`gateway ${res.status} for ${path}`);
  return (await res.json()) as unknown;
}

export async function getBalance(
  fetchFn: GatewayFetch,
  chainId: number,
  address: string,
): Promise<{ wei: bigint }> {
  if (!ALLOWED.has(chainId)) throw new Error(`forbidden chain ${chainId}`);
  EvmAddress.parse(address);
  const body = BalanceResp.parse(await readJson(fetchFn, `/v1/evm/${chainId}/balance/${address}`));
  return { wei: BigInt(body.balanceWei) };
}

export async function getHistory(
  fetchFn: GatewayFetch,
  chainId: number,
  address: string,
  cursor?: string,
): Promise<{ txs: Array<{ hash: string; to: string; valueWei: bigint }>; nextCursor?: string }> {
  if (!ALLOWED.has(chainId)) throw new Error(`forbidden chain ${chainId}`);
  EvmAddress.parse(address);
  const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const body = HistoryResp.parse(await readJson(fetchFn, `/v1/evm/${chainId}/history/${address}${q}`));
  return {
    txs: body.txs.map((t) => ({ hash: t.hash, to: t.to, valueWei: BigInt(t.valueWei) })),
    ...(body.nextCursor === undefined ? {} : { nextCursor: body.nextCursor }),
  };
}

export async function broadcast(
  fetchFn: GatewayFetch,
  chainId: number,
  rawTx: string,
): Promise<{ txHash: `0x${string}` }> {
  if (!ALLOWED.has(chainId)) throw new Error(`forbidden chain ${chainId}`);
  HexStrict.parse(rawTx);
  if (rawTx.length < 10) throw new Error("rawTx too short");
  const body = BroadcastResp.parse(
    await readJson(fetchFn, `/v1/evm/${chainId}/broadcast`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rawTx }),
    }),
  );
  return { txHash: body.txHash as `0x${string}` };
}
