// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

// Opaque session handle — TS never sees seed. Real impl lives in Rust (UniFFI/WASM).
export const SessionId = z.number().int().positive();
export type SessionId = z.infer<typeof SessionId>;

export const CurveSchema = z.enum(["Secp256k1", "Ed25519"]);
export type Curve = z.infer<typeof CurveSchema>;

export interface EncryptedVault {
  version: 1;
  saltHex: string; // 32B
  nonceHex: string; // 24B
  ciphertextHex: string;
  argon2: { mKib: number; tCost: number; pCost: number };
}

export interface EvmSignRequest {
  chainId: number;
  to?: `0x${string}`;
  valueWei: string; // decimal string of u256, bigint-safe
  nonce: number;
  gasLimit: string;
  maxFeePerGasWei: string;
  maxPriorityFeePerGasWei: string;
  dataHex: `0x${string}`;
  path: string;
  typedDataHashHex?: `0x${string}`;
}

export interface SolanaSignRequest { messageBytesHex: string; path: string }
export interface BtcSignRequest {
  inputs: { sighashHex: string; path: string }[];
  psbtBase64: string;
  feeSats: string;
  totalInSats: string;
  totalOutSats: string;
  allowHighFee: boolean;
}
export interface AdaSignRequest { txBodyCborHex: string; witnessPaths: string[] }

export interface SignerIface {
  generateMnemonic(strengthBits: 128 | 256): Promise<string>;
  validateMnemonic(phrase: string): Promise<boolean>;
  entropyToVault(phrase: string, password: string, lightKdf?: boolean): Promise<EncryptedVault>;
  unlockVault(vault: EncryptedVault, password: string): Promise<SessionId>;
  lock(sessionId: SessionId): Promise<void>;
  derivePubkey(sessionId: SessionId, path: string, curve: Curve): Promise<{ publicKeyHex: string; address: string }>;
  signEvm(sessionId: SessionId, req: EvmSignRequest): Promise<{ rawTxHex: string; txHashHex: string }>;
  signSolana(sessionId: SessionId, req: SolanaSignRequest): Promise<{ signatureBase58: string; publicKeyBase58: string }>;
  signBitcoin(sessionId: SessionId, req: BtcSignRequest): Promise<{ signatures: { publicKeyHex: string; derSigHex: string }[] }>;
  signCardano(sessionId: SessionId, req: AdaSignRequest): Promise<{ witnesses: { publicKeyHex: string; signatureHex: string }[]; txBodyHashHex: string }>;
}

// Path allowlist mirrored from Rust (defense in depth — Rust re-validates).
const ALLOWED = [/^m\/44'\/60'\/\d+'\/\d+\/\d+$/, /^m\/44'\/501'\/\d+'\/\d+'$/, /^m\/84'\/0'\/\d+'\/\d+\/\d+$/, /^m\/86'\/0'\/\d+'\/\d+\/\d+$/, /^m\/1852'\/1815'\/\d+'\/\d+\/\d+$/];
export function isPathAllowed(path: string): boolean {
  return ALLOWED.some((re) => re.test(path));
}

const ALLOWED_CHAINS = new Set([1, 56, 137, 42161, 8453, 11155111, 97, 80002, 421614, 84532]);
export function isChainAllowed(chainId: number): boolean {
  return ALLOWED_CHAINS.has(chainId);
}
