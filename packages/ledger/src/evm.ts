// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import { LEDGER_ALLOWED_EVM_CHAINS } from "./transport.js";
import { evaluateBlindSignPolicy, type DeviceAttestation } from "./policy.js";

const EvmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const Hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const HashHex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const UintStr = z.string().regex(/^\d+$/);

export const EvmHardwareInput = z.object({
  chainId: z.number().int(),
  to: EvmAddress,
  /** Decimal string in wei — parsed to bigint internally (bigint money). */
  valueWei: UintStr,
  nonce: z.number().int().nonnegative(),
  gasLimit: UintStr,
  maxFeePerGasWei: UintStr,
  maxPriorityFeePerGasWei: UintStr,
  dataHex: Hex.default("0x"),
  derivationPath: z
    .string()
    .regex(/^m(\/\d+'?)+$/)
    .default("m/44'/60'/0'/0/0"),
  /** EIP-712 typed-data hash for the approval-UI display model. */
  typedDataHashHex: HashHex32.optional(),
  /** True when calldata is opaque/unknown to the decoder (forces blind-sign path). */
  opaqueData: z.boolean().default(false),
  deviceAttestation: z.object({ hashDisplayed: z.boolean() }).default({ hashDisplayed: true }),
});
export type EvmHardwareInput = z.infer<typeof EvmHardwareInput>;

function u256ToBytes32(dec: string): string {
  const v = BigInt(dec);
  if (v < 0n || v >= 1n << 256n) throw new Error("u256 out of range");
  return v.toString(16).padStart(64, "0");
}

function decodeCalldata(dataHex: string): string {
  if (dataHex === "0x" || dataHex === "0X") return "Native transfer";
  const lower = dataHex.toLowerCase();
  if (lower.startsWith("0xa9059cbb")) return "ERC-20 transfer";
  if (lower.startsWith("0x095ea7b3")) return "ERC-20 approve";
  if (lower.startsWith("0x")) return `Contract call (${Math.floor((dataHex.length - 2) / 2)} bytes)`;
  return "Contract call";
}

export const EvmHardwareIntent = z.object({
  chainId: z.number().int(),
  to: EvmAddress,
  valueWei: UintStr,
  nonce: z.number().int().nonnegative(),
  gasLimit: UintStr,
  maxFeePerGasWei: UintStr,
  maxPriorityFeePerGasWei: UintStr,
  dataHex: Hex,
  path: z.string(),
  hardware: z.literal(true),
  typedDataHashHex: HashHex32.optional(),
  // Structural mirror of packages/chains-evm signer request (snake_case).
  signerRequest: z.object({
    chain_id: z.number().int(),
    to: z.string(),
    value_wei_hex: z.string(),
    nonce: z.number().int().nonnegative(),
    gas_limit: z.string(),
    max_fee_hex: z.string(),
    max_priority_hex: z.string(),
    data_hex: z.string(),
    path: z.string(),
  }),
});
export type EvmHardwareIntent = z.infer<typeof EvmHardwareIntent>;

export const EvmHardwareDisplay = z.object({
  decodedCall: z.string(),
  warnings: z.array(z.string()),
});
export type EvmHardwareDisplay = z.infer<typeof EvmHardwareDisplay>;

export const EvmHardwareBuilt = z.object({
  intent: EvmHardwareIntent,
  display: EvmHardwareDisplay,
});
export type EvmHardwareBuilt = z.infer<typeof EvmHardwareBuilt>;

export function buildEvmHardwareIntent(input: z.input<typeof EvmHardwareInput>): EvmHardwareBuilt {
  const p = EvmHardwareInput.parse(input);
  if (!LEDGER_ALLOWED_EVM_CHAINS.has(p.chainId)) throw new Error(`forbidden chain ${p.chainId}`);
  // Bigint money: validate exact amounts, compute fee without float.
  const value = BigInt(p.valueWei);
  const gas = BigInt(p.gasLimit);
  const fee = gas * BigInt(p.maxFeePerGasWei);
  if (value < 0n || fee < 0n) throw new Error("negative money");

  const isOpaqueCalldata = p.opaqueData || (p.dataHex !== "0x" && decodeCalldata(p.dataHex).startsWith("Contract call ("));
  const kind = p.typedDataHashHex !== undefined ? "typedData" : p.opaqueData || isOpaqueCalldata ? "opaque" : "personal_sign";
  const attestation: DeviceAttestation = { hashDisplayed: p.deviceAttestation.hashDisplayed };
  const decision = evaluateBlindSignPolicy({ kind, opaque: p.opaqueData || isOpaqueCalldata, deviceAttestation: attestation });
  if (decision.verdict === "block") throw new Error(decision.warnings[0] ?? "OPAQUE_SIGN blocked");

  const to20 = p.to.toLowerCase().slice(2);
  const intent = EvmHardwareIntent.parse({
    chainId: p.chainId,
    to: p.to,
    valueWei: p.valueWei,
    nonce: p.nonce,
    gasLimit: p.gasLimit,
    maxFeePerGasWei: p.maxFeePerGasWei,
    maxPriorityFeePerGasWei: p.maxPriorityFeePerGasWei,
    dataHex: p.dataHex,
    path: p.derivationPath,
    hardware: true,
    ...(p.typedDataHashHex === undefined ? {} : { typedDataHashHex: p.typedDataHashHex }),
    signerRequest: {
      chain_id: p.chainId,
      to: to20,
      value_wei_hex: u256ToBytes32(p.valueWei),
      nonce: p.nonce,
      gas_limit: p.gasLimit,
      max_fee_hex: u256ToBytes32(p.maxFeePerGasWei),
      max_priority_hex: u256ToBytes32(p.maxPriorityFeePerGasWei),
      data_hex: p.dataHex,
      path: p.derivationPath,
    },
  });

  const warnings: string[] = [...decision.warnings];
  warnings.unshift("Hardware wallet: confirm the address and amount on the device screen.");
  const decodedCall =
    p.typedDataHashHex !== undefined
      ? `EIP-712 typed-data (hash ${p.typedDataHashHex.slice(0, 10)}…) — ${decodeCalldata(p.dataHex)}`
      : decodeCalldata(p.dataHex);

  return { intent, display: { decodedCall, warnings } };
}
