// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import {
  NftCollectionFilter,
  spamScore,
  type NftAsset,
} from "@drift/features";
import { screenChrome, type ScreenChrome } from "../watchonly.js";

// NFT gallery view-model (iteration 3): collection allow/blocklist + spam
// filter from @drift/features; hidden-by-default spam with explicit reveal;
// transfer CTA gated by watch-only.

export interface NftGalleryModel {
  visible: Array<{ asset: NftAsset; spamScore: number }>;
  hiddenCount: number;
  hidden: Array<{ asset: NftAsset; reasons: string[] }>;
  canTransfer: boolean;
  chrome: ScreenChrome;
}

const NftAssetInput = z.object({
  standard: z.enum(["erc721", "erc1155", "metaplex"]),
  chain: z.string().min(1),
  contract: z.string().min(1),
  tokenId: z.string().min(1),
  owner: z.string().min(1),
  name: z.string().optional(),
  imageUrl: z.string().optional(),
  collectionId: z.string().optional(),
});

export function nftGalleryModel(
  rawAssets: unknown[],
  filter: { allowlist?: string[]; blocklist?: string[]; revealed?: string[] },
  opts?: { watchOnly?: boolean },
): NftGalleryModel {
  const assets = z.array(NftAssetInput).parse(rawAssets) as NftAsset[];
  const chrome = screenChrome(opts?.watchOnly ?? false);
  const f = new NftCollectionFilter({
    allowlist: filter.allowlist ?? [],
    blocklist: filter.blocklist ?? [],
  });
  for (const r of filter.revealed ?? []) f.reveal(r);
  const { visible, hidden } = f.filterAll(assets);
  return {
    visible: visible.map((asset) => ({ asset, spamScore: spamScore(asset) })),
    hiddenCount: hidden.length,
    hidden: hidden.map((h) => ({ asset: h.asset, reasons: h.reasons })),
    canTransfer: chrome.canSign,
    chrome,
  };
}

/** Reveal one hidden collection (returns the reasons it was hidden). */
export function revealCollection(
  rawAssets: unknown[],
  filter: { allowlist?: string[]; blocklist?: string[] },
  collectionIdOrContract: string,
): { reasons: string[] } {
  const assets = z.array(NftAssetInput).parse(rawAssets) as NftAsset[];
  const f = new NftCollectionFilter({ allowlist: filter.allowlist ?? [], blocklist: filter.blocklist ?? [] });
  const target = assets.find((a) => (a.collectionId ?? a.contract).toLowerCase() === collectionIdOrContract.toLowerCase());
  if (!target) throw new Error("unknown collection");
  const before = f.isVisible(target);
  f.reveal(collectionIdOrContract);
  return { reasons: before.reasons };
}
