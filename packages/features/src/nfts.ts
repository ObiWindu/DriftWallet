// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

/**
 * U043 — NFTs: gallery models, spam filter, transfers.
 *
 * Transfers reuse the standard approval screen: builders emit calldata
 * (`dataHex`) for EVM plus a structural `solanaReq`-style dict for SPL, each
 * paired with policy hint flags the approval UI renders as warnings.
 */

// ---------------------------------------------------------------- schemas

export const NftStandardSchema = z.enum(["erc721", "erc1155", "metaplex"]);
export type NftStandard = z.infer<typeof NftStandardSchema>;

export const NftAssetSchema = z.object({
  standard: NftStandardSchema,
  chain: z.string().min(1),
  contract: z.string().min(1),
  tokenId: z.string().min(1),
  owner: z.string().min(1),
  name: z.string().optional(),
  imageUrl: z.string().optional(),
  collectionId: z.string().optional(),
});
export type NftAsset = z.infer<typeof NftAssetSchema>;

export const NftCollectionSchema = z.object({
  id: z.string().min(1),
  chain: z.string().min(1),
  name: z.string().min(1),
  contract: z.string().min(1),
  standard: NftStandardSchema,
  itemCount: z.number().int().nonnegative(),
});
export type NftCollection = z.infer<typeof NftCollectionSchema>;

export const NftTransferSchema = z.object({
  standard: NftStandardSchema,
  chain: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  /** EVM calldata, or the SPL instruction payload encoded as hex. */
  dataHex: z.string().regex(/^0x[0-9a-fA-F]*$/),
  policyHints: z.array(z.string()),
});
export type NftTransfer = z.infer<typeof NftTransferSchema>;

// ---------------------------------------------------------------- spam

const BLOCKLISTED_CONTRACTS = new Set(
  ["0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"].map((s) => s.toLowerCase()),
);

const SPAM_NAME_RES = [
  /airdrop/i,
  /claim/i,
  /free mint/i,
  /double/i,
  /reward/i,
  /visit .{0,20}\./,
  /bonus/i,
];

const SPAM_URL_RES = [
  /https?:\/\/[^\s]*claim[^\s]*/i,
  /https?:\/\/[^\s]*airdrop[^\s]*/i,
  /\.tk(\/|$)/i,
  /\.ml(\/|$)/i,
  /free-?mint/i,
];

export function isSpamNft(asset: NftAsset): { spam: boolean; reasons: string[] } {
  NftAssetSchema.parse(asset);
  const reasons: string[] = [];
  if (BLOCKLISTED_CONTRACTS.has(asset.contract.toLowerCase())) {
    reasons.push("contract is blocklisted");
  }
  const name = asset.name ?? "";
  if (name && SPAM_NAME_RES.some((re) => re.test(name))) {
    reasons.push("suspicious name pattern");
  }
  const url = asset.imageUrl ?? "";
  if (url && SPAM_URL_RES.some((re) => re.test(url))) {
    reasons.push("suspicious url pattern");
  }
  // unnamed + off-chain image with no collection context smells like a dust drop
  if (!name && !asset.collectionId) {
    reasons.push("unidentified collection");
  }
  return { spam: reasons.length > 0, reasons };
}

// ---------------------------------------------------------------- calldata

function pad32(hexNoPrefix: string): string {
  return hexNoPrefix.toLowerCase().padStart(64, "0");
}

function addrToWord(addr: string): string {
  const clean = z.string().regex(/^0x[0-9a-fA-F]{40}$/).parse(addr).slice(2);
  return pad32(clean);
}

function uintToWord(value: bigint | string | number): string {
  const v = BigInt(String(value));
  if (v < 0n) throw new Error("uint must be >= 0");
  return pad32(v.toString(16));
}

// keccak("transferFrom(address,address,uint256)") = 0x23b872dd
const ERC721_TRANSFER_FROM = "0x23b872dd";
// keccak("safeTransferFrom(address,address,uint256,uint256,bytes)") = 0xf242432a
const ERC1155_SAFE_TRANSFER_FROM = "0xf242432a";

/** ERC-721 `transferFrom(from, to, tokenId)` calldata. */
export function buildErc721Transfer(
  chain: string,
  contract: string,
  from: string,
  to: string,
  tokenId: bigint | string | number,
): NftTransfer {
  z.string().min(1).parse(chain);
  z.string().regex(/^0x[0-9a-fA-F]{40}$/).parse(contract);
  const dataHex = `${ERC721_TRANSFER_FROM}${addrToWord(from)}${addrToWord(to)}${uintToWord(tokenId)}`;
  return NftTransferSchema.parse({
    standard: "erc721",
    chain,
    from,
    to,
    dataHex,
    policyHints: ["nft transfer — verify the collection and token id"],
  });
}

/**
 * ERC-1155 `safeTransferFrom(from, to, id, amount, data)` calldata
 * (empty bytes payload).
 */
export function buildErc1155Transfer(
  chain: string,
  contract: string,
  from: string,
  to: string,
  tokenId: bigint | string | number,
  amount: bigint | string | number,
): NftTransfer {
  z.string().min(1).parse(chain);
  z.string().regex(/^0x[0-9a-fA-F]{40}$/).parse(contract);
  const amt = BigInt(String(amount));
  if (amt <= 0n) throw new Error("amount must be > 0");
  // 5 fixed words then dynamic-bytes tail (offset=0xa0, len=0)
  const dataHex =
    `${ERC1155_SAFE_TRANSFER_FROM}${addrToWord(from)}${addrToWord(to)}` +
    `${uintToWord(tokenId)}${uintToWord(amt)}${uintToWord(5 * 32)}${uintToWord(0)}`;
  return NftTransferSchema.parse({
    standard: "erc1155",
    chain,
    from,
    to,
    dataHex,
    policyHints: ["nft transfer — verify the collection, token id and amount"],
  });
}

const RE_BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export interface SplNftTransferDish {
  program: "metaplex-token-metadata";
  instruction: "transfer";
  mint: string;
  from: string;
  to: string;
  amount: string;
}

/**
 * SPL / Metaplex NFT transfer "dish": a structural instruction dict for the
 * signer, plus a hex-encoded payload so approval UIs treat it like EVM
 * calldata (opaque bytes + decoded summary, never blind-signed).
 */
export function buildSplNftTransfer(
  mint: string,
  from: string,
  to: string,
): { transfer: NftTransfer; dish: SplNftTransferDish } {
  z.string().regex(RE_BASE58).parse(mint);
  z.string().regex(RE_BASE58).parse(from);
  z.string().regex(RE_BASE58).parse(to);
  const dish: SplNftTransferDish = {
    program: "metaplex-token-metadata",
    instruction: "transfer",
    mint,
    from,
    to,
    amount: "1",
  };
  // Deterministic hex encoding of the dish summary for display parity.
  const payload = `spl-transfer:${mint}:${from}:${to}:1`;
  let hex = "0x";
  for (const ch of payload) hex += ch.charCodeAt(0).toString(16).padStart(2, "0");
  const transfer = NftTransferSchema.parse({
    standard: "metaplex",
    chain: "solana:mainnet",
    from,
    to,
    dataHex: hex,
    policyHints: ["spl nft transfer — verify the mint and destination"],
  });
  return { transfer, dish };
}
