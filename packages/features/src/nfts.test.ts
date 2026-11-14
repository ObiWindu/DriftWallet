// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  buildErc1155Transfer,
  buildErc721Transfer,
  buildSplNftTransfer,
  isSpamNft,
  NftAssetSchema,
  NftCollectionFilter,
  spamScore,
  type NftAsset,
} from "./nfts.js";

const FROM = "0x1111111111111111111111111111111111111111";
const TO = "0x2222222222222222222222222222222222222222";
const MINT = "Mint111111111111111111111111111111111111111";

describe("nfts", () => {
  it("validates asset/collection schemas across standards", () => {
    const erc721 = NftAssetSchema.parse({
      standard: "erc721",
      chain: "eip155:1",
      contract: FROM,
      tokenId: "7",
      owner: TO,
      name: "Cool Ape #7",
    });
    expect(erc721.standard).toBe("erc721");
    expect(() =>
      NftAssetSchema.parse({ standard: "erc777", chain: "eip155:1", contract: FROM, tokenId: "1", owner: TO }),
    ).toThrow();
    expect(() => NftAssetSchema.parse({ standard: "erc721", chain: "eip155:1" })).toThrow();
  });

  it("flags spam nfts by name/url heuristics + blocklist", () => {
    const legit: NftAsset = {
      standard: "erc721",
      chain: "eip155:1",
      contract: FROM,
      tokenId: "1",
      owner: TO,
      name: "Pixel Punk #1",
      collectionId: "pixel-punks",
    };
    expect(isSpamNft(legit)).toMatchObject({ spam: false });
    const airdrop: NftAsset = { ...legit, name: "CLAIM YOUR AIRDROP REWARD visit x.io" };
    const r1 = isSpamNft(airdrop);
    expect(r1.spam).toBe(true);
    expect(r1.reasons.length).toBeGreaterThan(0);
    const badUrl: NftAsset = { ...legit, imageUrl: "https://evil-claim-site.io/airdrop.png" };
    expect(isSpamNft(badUrl).spam).toBe(true);
    const blocklisted: NftAsset = {
      ...legit,
      contract: "0xDeaDbEEFDeaDbEEFDeaDbEEFDeaDbEEFDeaDbEEF",
    };
    expect(isSpamNft(blocklisted).reasons).toContain("contract is blocklisted");
    const dust: NftAsset = { standard: "erc1155", chain: "eip155:1", contract: FROM, tokenId: "9", owner: TO };
    expect(isSpamNft(dust).spam).toBe(true);
  });

  it("builds erc721 transferFrom calldata", () => {
    const t = buildErc721Transfer("eip155:1", FROM, FROM, TO, 7n);
    expect(t.dataHex.startsWith("0x23b872dd")).toBe(true);
    expect(t.dataHex).toHaveLength(2 + 8 + 64 * 3);
    expect(t.policyHints.length).toBeGreaterThan(0);
    // token id is the last word
    expect(t.dataHex.slice(-64)).toBe("0".repeat(62) + "07");
    expect(() => buildErc721Transfer("eip155:1", FROM, "0xbad", TO, 1n)).toThrow();
  });

  it("builds erc1155 safeTransferFrom calldata", () => {
    const t = buildErc1155Transfer("eip155:1", FROM, FROM, TO, 3n, 2n);
    expect(t.dataHex.startsWith("0xf242432a")).toBe(true);
    // 4 fixed words (from,to,id,amount) + offset + length
    expect(t.dataHex).toHaveLength(2 + 8 + 64 * 6);
    expect(() => buildErc1155Transfer("eip155:1", FROM, FROM, TO, 3n, 0n)).toThrow();
  });

  it("builds SPL metaplex transfer dish + hex payload", () => {
    const from = `From${"1".repeat(39)}`;
    const dest = `Dest${"1".repeat(39)}`;
    const { transfer, dish } = buildSplNftTransfer(MINT, from, dest);
    expect(transfer.standard).toBe("metaplex");
    expect(transfer.dataHex.startsWith("0x")).toBe(true);
    expect(transfer.from).toBe(from);
    expect(transfer.to).toBe(dest);
    expect(dish).toMatchObject({ program: "metaplex-token-metadata", instruction: "transfer", amount: "1" });
    expect(() => buildSplNftTransfer("not-base58!!", from, dest)).toThrow();
  });
});

describe("NFT collection filter + spam scoring (iteration 3)", () => {
  const good: NftAsset = {
    standard: "erc721", chain: "eip155:1", contract: "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D",
    tokenId: "1", owner: "0xabc", name: "Bored Ape #1", collectionId: "bayc",
  };
  const airdrop: NftAsset = {
    standard: "erc721", chain: "eip155:1", contract: "0x0000000000000000000000000000000000000001",
    tokenId: "9", owner: "0xabc", name: "FREE AIRDROP CLAIM NOW",
  };
  const unknown: NftAsset = {
    standard: "metaplex", chain: "solana:mainnet", contract: "metaplex", tokenId: "7", owner: "So1",
  };

  it("hides spam by default, reveals on demand, honors allow/blocklists", () => {
    const f = new NftCollectionFilter({ allowlist: [], blocklist: ["bayc"] });
    const res = f.filterAll([good, airdrop, unknown]);
    // bayc blocklisted, airdrop spam, unknown unidentified -> all hidden
    expect(res.visible).toEqual([]);
    expect(res.hidden).toHaveLength(3);
    expect(res.hidden[0]?.reasons).toContain("collection is blocklisted");
    expect(res.hidden[1]?.reasons.some((r) => r.includes("suspicious name"))).toBe(true);

    f.reveal("bayc");
    const res2 = f.filterAll([good]);
    expect(res2.visible).toHaveLength(1); // revealed despite blocklist

    const allow = new NftCollectionFilter({ allowlist: ["bayc"], blocklist: [] });
    expect(allow.isVisible(good).visible).toBe(true);
    expect(allow.isVisible(airdrop).visible).toBe(false);
  });

  it("spamScore counts reasons; exportJSON round-trips lists", () => {
    expect(spamScore(airdrop)).toBeGreaterThan(0);
    expect(spamScore(good)).toBe(0);
    const f = new NftCollectionFilter({ allowlist: ["a"], blocklist: ["b"] });
    f.reveal("b");
    const json = JSON.parse(f.exportJSON());
    expect(json.allowlist).toEqual(["a"]);
    expect(json.blocklist).toEqual(["b"]);
    expect(json.revealed).toEqual(["b"]);
  });
});
