// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import * as bitcoin from "bitcoinjs-lib";

export const BtcTransfer = z.object({
  fromBech32: z.string().regex(/^(bc1|tb1|bcrt1)/),
  toBech32: z.string().regex(/^(bc1|tb1|bcrt1)/),
  amountSats: z.string().regex(/^\d+$/),
  feeSats: z.string().regex(/^\d+$/),
  changeBech32: z.string().regex(/^(bc1|tb1|bcrt1)/),
});
export type BtcTransfer = z.infer<typeof BtcTransfer>;

export function checkFeePolicy(totalIn: bigint, totalOut: bigint, fee: bigint, allowHighFee: boolean): void {
  if (totalOut > totalIn) throw new Error("outputs exceed inputs");
  if (totalIn - totalOut !== fee) throw new Error("fee mismatch");
  if (totalIn > 0n && fee * 100n > totalIn * 5n && !allowHighFee) {
    throw new Error(`fee ${fee} sats > 5% of inputs`);
  }
  if (fee > 1_000_000n && !allowHighFee) throw new Error("fee > 0.01 BTC cap");
}

export function validatePsbtEnvelope(psbtBase64: string): void {
  const raw = Buffer.from(psbtBase64, "base64");
  if (raw.length < 5 || raw.subarray(0, 5).toString("binary") !== "psbt\xff") {
    throw new Error("psbt magic");
  }
}

export function dustLimitSats(): bigint {
  return 546n;
}

// ---------------------------------------------------------------------------
// T006: PSBT builder (P2WPKH, RBF, largest-first coin selection) + broadcast
// ---------------------------------------------------------------------------

/** RBF opt-in sequence (BIP-125). */
export const RBF_SEQUENCE = 0xfffffffd;

const Bech32 = z.string().regex(/^(bc1|tb1|bcrt1)[qp][0-9a-z]{38,59}$/);
const SatsStr = z.string().regex(/^\d+$/);

export const BtcUtxo = z.object({
  /** Display-order txid hex (big-endian, 64 chars). */
  txid: z.string().regex(/^[0-9a-fA-F]{64}$/),
  vout: z.number().int().nonnegative(),
  valueSats: SatsStr,
  /** Optional: raw scriptPubKey hex. Derived from `address` when omitted. */
  scriptPubKeyHex: z
    .string()
    .regex(/^[0-9a-fA-F]+$/)
    .optional(),
  /** P2WPKH or P2TR-key-path address owning this UTXO. Required when scriptPubKeyHex omitted. */
  address: Bech32.optional(),
});
export type BtcUtxo = z.infer<typeof BtcUtxo>;

export const BuildPsbtInput = z.object({
  utxos: z.array(BtcUtxo).min(1),
  toBech32: Bech32,
  amountSats: SatsStr,
  /** Sat/vB fee rate, integer string. */
  feeRateSatVb: SatsStr,
  changeBech32: Bech32,
  allowHighFee: z.boolean().default(false),
});
export type BuildPsbtInput = z.infer<typeof BuildPsbtInput>;

export interface BuiltPsbt {
  psbtBase64: string;
  feeSats: bigint;
  totalInSats: bigint;
  totalOutSats: bigint;
  changeSats: bigint;
  inputCount: number;
  outputCount: number;
}

function networkFor(addr: string): bitcoin.networks.Network {
  if (addr.startsWith("bc1")) return bitcoin.networks.bitcoin;
  if (addr.startsWith("tb1")) return bitcoin.networks.testnet;
  return bitcoin.networks.regtest;
}

function sameNetwork(a: string, b: string): boolean {
  const net = (s: string): string => (s.startsWith("bc1") ? "main" : s.startsWith("tb1") ? "test" : "regtest");
  return net(a) === net(b);
}

/** vsize estimate: 10.5 overhead + 68/vB P2WPKH in (58/vB P2TR key-path) + 31/out. */
function estimateVsizeMixed(nWpkhIn: number, nTrIn: number, nOut: number): number {
  return Math.ceil(10.5 + 68 * nWpkhIn + 58 * nTrIn + 31 * nOut);
}

type ScriptKind = "p2wpkh" | "p2tr";

function scriptKind(script: Uint8Array): ScriptKind {
  if (script.length === 22 && script[0] === 0x00 && script[1] === 0x14) return "p2wpkh";
  // P2TR key-path: OP_1 <32-byte x-only key>. Script-path inputs unsupported.
  if (script.length === 34 && script[0] === 0x51 && script[1] === 0x20) return "p2tr";
  throw new Error("only P2WPKH/P2TR-key-path inputs supported");
}

function scriptForUtxo(u: BtcUtxo, network: bitcoin.networks.Network): { script: Uint8Array; kind: ScriptKind } {
  const raw: Uint8Array = (() => {
    if (u.scriptPubKeyHex) return Buffer.from(u.scriptPubKeyHex, "hex");
    if (!u.address) throw new Error("utxo needs address or scriptPubKeyHex");
    return bitcoin.address.toOutputScript(u.address, network);
  })();
  const kind = scriptKind(raw);
  return { script: raw, kind };
}

export function buildPsbt(input: z.input<typeof BuildPsbtInput>): BuiltPsbt {
  const p = BuildPsbtInput.parse(input);
  const amount = BigInt(p.amountSats);
  const feeRate = BigInt(p.feeRateSatVb);
  if (amount <= 0n) throw new Error("amount must be positive");
  if (feeRate <= 0n) throw new Error("fee rate must be positive");
  if (!sameNetwork(p.toBech32, p.changeBech32)) throw new Error("change network mismatch");
  const network = networkFor(p.toBech32);
  // Validate recipient/change decode on the same network.
  bitcoin.address.toOutputScript(p.toBech32, network);
  bitcoin.address.toOutputScript(p.changeBech32, network);

  // Largest-first coin selection. Decode scripts upfront so fees use the
  // exact per-kind vsize (P2WPKH 68 vB, P2TR key-path 58 vB).
  const sorted = [...p.utxos]
    .map((u) => ({ u, value: BigInt(u.valueSats) }))
    .sort((a, b) => (a.value > b.value ? -1 : a.value < b.value ? 1 : 0));
  const decoded = sorted.map(({ u, value }) => {
    if (!u.address && !u.scriptPubKeyHex) throw new Error("utxo needs address or scriptPubKeyHex");
    if (u.address && !sameNetwork(u.address, p.toBech32)) throw new Error("utxo network mismatch");
    const { script, kind } = scriptForUtxo(u, network);
    return { u, value, script, kind };
  });
  const vsizeFor = (ins: typeof decoded, nOut: number): number => {
    const wpkh = ins.filter((i) => i.kind === "p2wpkh").length;
    return estimateVsizeMixed(wpkh, ins.length - wpkh, nOut);
  };

  const DUST = dustLimitSats();
  let selected: typeof decoded = [];
  let total = 0n;
  // Greedily cover amount + worst-case (2-output) fee.
  for (const cand of decoded) {
    selected.push(cand);
    total += cand.value;
    const fee = BigInt(vsizeFor(selected, 2)) * feeRate;
    if (total >= amount + fee) break;
  }
  let fee = BigInt(vsizeFor(selected, 2)) * feeRate;
  if (total < amount + fee) throw new Error("insufficient funds");

  let change = total - amount - fee;
  let withChange = true;
  if (change > 0n && change < DUST) {
    // Dust change: absorb into fee, single output.
    withChange = false;
    fee = BigInt(vsizeFor(selected, 1)) * feeRate;
    if (total < amount + fee) throw new Error("insufficient funds");
    change = total - amount - fee;
    if (change !== 0n && change < DUST) throw new Error("dust output");
  }
  if (change < 0n) throw new Error("insufficient funds");
  if (withChange && change !== 0n && !sameNetwork(p.changeBech32, p.toBech32)) {
    throw new Error("change network mismatch");
  }

  const totalOut = amount + (withChange ? change : 0n);
  checkFeePolicy(total, totalOut, fee, p.allowHighFee);

  const psbt = new bitcoin.Psbt({ network });
  for (const { u, script, kind } of selected) {
    const txidLE = Buffer.from(u.txid, "hex").reverse();
    if (kind === "p2tr") {
      // Key-path spend: x-only internal key committed via tapInternalKey.
      // The signer tweaks it (BIP86) and returns a Schnorr signature.
      psbt.addInput({
        hash: txidLE,
        index: u.vout,
        sequence: RBF_SEQUENCE,
        witnessUtxo: { script, value: BigInt(u.valueSats) },
        tapInternalKey: Buffer.from(script.subarray(2, 34)),
      });
      continue;
    }
    psbt.addInput({
      hash: txidLE,
      index: u.vout,
      sequence: RBF_SEQUENCE,
      witnessUtxo: { script, value: BigInt(u.valueSats) },
    });
  }
  psbt.addOutput({ address: p.toBech32, value: amount });
  if (withChange && change > 0n) psbt.addOutput({ address: p.changeBech32, value: change });

  const psbtBase64 = psbt.toBase64();
  validatePsbtEnvelope(psbtBase64);
  return {
    psbtBase64,
    feeSats: fee,
    totalInSats: total,
    totalOutSats: totalOut,
    changeSats: withChange ? change : 0n,
    inputCount: selected.length,
    outputCount: withChange && change > 0n ? 2 : 1,
  };
}

/** Injected gateway transport. Never call global fetch directly (keeps tests hermetic). */
export type GatewayFetch = (path: string, init?: RequestInit) => Promise<Response>;

const BroadcastResp = z.object({ txid: z.string().regex(/^[0-9a-fA-F]{64}$/) });

export async function broadcast(fetchFn: GatewayFetch, psbtBase64: string): Promise<{ txid: string }> {
  validatePsbtEnvelope(psbtBase64);
  const res = await fetchFn(`/v1/btc/broadcast`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rawTx: psbtBase64 }),
  });
  if (!res.ok) throw new Error(`gateway ${res.status} for /v1/btc/broadcast`);
  const body = BroadcastResp.parse((await res.json()) as unknown);
  return { txid: body.txid };
}
