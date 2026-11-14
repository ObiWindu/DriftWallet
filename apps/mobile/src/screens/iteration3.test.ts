// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { portfolioView, centsToPriceStr } from "./portfolio.js";
import { swapScreenModel, swapAllowance } from "./swap.js";
import { stakeScreenModel, stakeRow, rewardsView } from "./stake.js";
import { nftGalleryModel, revealCollection } from "./nfts.js";
import { duressInit, duressNext, securityScreenModel, setSpendLimitCents } from "./security.js";
import { assertCanSign, screenChrome } from "../watchonly.js";
import { canVisitWatchOnly, ROUTES, SIGN_ROUTES } from "../navigation.js";
import { createWalletStore } from "../store.js";

describe("watch-only chrome guard", () => {
  it("banner + canSign false when watch-only; assertCanSign throws", () => {
    expect(screenChrome(true)).toEqual({ canSign: false, bannerKey: "watchOnly.banner" });
    expect(screenChrome(false)).toEqual({ canSign: true, bannerKey: null });
    expect(() => assertCanSign(true)).toThrow(/watch-only/);
    expect(() => assertCanSign(false)).not.toThrow();
  });

  it("sign routes are gated for watch-only navigation", () => {
    expect([...SIGN_ROUTES].sort()).toEqual(["Send", "Stake", "Swap"]);
    for (const r of SIGN_ROUTES) expect(canVisitWatchOnly(r, true, true)).toBe(false);
    expect(canVisitWatchOnly("Home", true, true)).toBe(true);
    expect(canVisitWatchOnly("Send", true, false)).toBe(true);
    expect(ROUTES).toContain("Swap");
    expect(ROUTES).toContain("Security");
  });

  it("store carries watchOnly + spend limit with validation", () => {
    const s = createWalletStore();
    expect(s.getState().watchOnly).toBe(false);
    s.getState().setWatchOnly(true);
    expect(s.getState().watchOnly).toBe(true);
    s.getState().setSpendLimitUsdCents("50000");
    expect(s.getState().spendLimitUsdCents).toBe("50000");
    expect(() => s.getState().setSpendLimitUsdCents("12.5")).toThrow();
    s.getState().unlock(7, { duress: true });
    expect(s.getState().lock).toMatchObject({ status: "unlocked", sessionId: 7, duress: true });
  });
});

describe("portfolio screen", () => {
  it("centsToPriceStr is exact", () => {
    expect(centsToPriceStr(320_050n)).toBe("3200.50");
    expect(centsToPriceStr(1n)).toBe("0.01");
    expect(() => centsToPriceStr(-1n)).toThrow();
  });

  it("allocation rows + sparkline + pnl + chrome", () => {
    const v = portfolioView({
      balances: [
        { chainId: "eip155:1", symbol: "ETH", totalBaseUnits: 2_000_000_000_000_000_000n, decimals: 18, priceCents: 200_000n },
        { chainId: "solana:mainnet", symbol: "SOL", totalBaseUnits: 5_000_000_000n, decimals: 9, priceCents: 10_000n },
        { chainId: "eip155:1", symbol: "USDC", totalBaseUnits: 0n, decimals: 6, priceCents: 0n },
      ],
      costBasisCents: { "ETH@eip155:1": "300000" }, // $3000 basis
      series: { ETH: Array.from({ length: 50 }, (_, i) => ({ t: i, p: 1900 + i * 2 })) },
      nowMs: 10_000,
    });
    expect(v.totalFiat).toBe("$4500.00");
    expect(v.rows[0]?.symbol).toBe("ETH");
    expect(v.rows[0]?.pctBps).toBe(8888);
    expect(v.rows[0]?.pnlUsdCents).toBe("100000"); // $4000 - $3000 = $1000 = 100000 cents
    expect(v.totalPnlUsdCents).toBe("100000");
    expect(v.staleAssets).toContain("USDC@eip155:1"); // price 0 -> unknown
    expect(v.sparkline.length).toBeLessThanOrEqual(32);
    expect(v.changeBps24h).toBe("516"); // (1998-1900)/1900 = 5.157% -> 516 bps
    expect(v.chrome.canSign).toBe(true);
    const wo = portfolioView({ balances: [], watchOnly: true, nowMs: 1 });
    expect(wo.chrome).toEqual({ canSign: false, bannerKey: "watchOnly.banner" });
  });
});

describe("swap screen", () => {
  const form = {
    chain: "eip155:1", sellToken: "native", buyToken: "USDC",
    amount: "1", amountBaseUnits: "1000000000000000000", slippageBps: 50, recipient: "0x1111111111111111111111111111111111111111",
  };
  const fetchQuote = async () => ({
    sellToken: "native", buyToken: "USDC",
    sellAmountBaseUnits: "1000000000000000000", buyAmountBaseUnits: "2000000000",
    priceImpactPct: "0.5", allowanceNeededBaseUnits: "0",
  });

  it("ok impact -> canSubmit (when not watch-only)", async () => {
    const m = await swapScreenModel(form, "0", fetchQuote);
    expect(m.impactTier).toBe("ok");
    expect(m.canSubmit).toBe(true);
    expect(m.review?.allowance.mode).toBe("exact");
    const wo = await swapScreenModel(form, "0", fetchQuote, { watchOnly: true });
    expect(wo.canSubmit).toBe(false);
    expect(wo.chrome.bannerKey).toBe("watchOnly.banner");
  });

  it("block impact -> canSubmit false even when not watch-only", async () => {
    const bad = async () => ({ ...(await fetchQuote()), priceImpactPct: "12.5" });
    const m = await swapScreenModel(form, "0", bad);
    expect(m.impactTier).toBe("block");
    expect(m.canSubmit).toBe(false);
    expect(m.warnings.some((w) => w.includes("blocked"))).toBe(true);
  });

  it("swapAllowance: exact default, infinite needs reason", () => {
    expect(swapAllowance("0", "100")).toMatchObject({ mode: "exact", amountBaseUnits: "100" });
    expect(swapAllowance("0", "0")).toMatchObject({ mode: "exact", amountBaseUnits: "0" });
    expect(() => swapAllowance("0", "100", { allowInfinite: true })).toThrow();
    expect(swapAllowance("0", "100", { allowInfinite: true, reason: "recurring" }).mode).toBe("infinite");
  });
});

describe("stake screen", () => {
  const SOL = "So1111111111111111111111111111111111111111";
  it("builds SOL + ADA rows and formats rewards", () => {
    const m = stakeScreenModel(
      [
        { action: "sol-stake", from: SOL, validatorVote: SOL, lamports: "2000000000" },
        { action: "ada-delegate", stakeAddress: "stake1uxyz", poolId: "ab".repeat(28) },
      ],
      [{ chain: "solana:mainnet", asset: "SOL", pendingBaseUnits: "1000", lifetimeBaseUnits: "5000", decimals: 9 }],
    );
    expect(m.rows).toHaveLength(2);
    expect(m.rows[0]?.amountLine).toBe("2 SOL");
    expect(m.rows[1]?.intent.signerRequest).toMatchObject({ kind: "delegate" });
    expect(m.rewards[0]?.claimedLine).toBe("0.000004 SOL");
    expect(m.canSubmit).toBe(true);
    const wo = stakeScreenModel([], [], { watchOnly: true });
    expect(wo.canSubmit).toBe(false);
  });

  it("rejects bad inputs", () => {
    expect(() => stakeRow({ action: "sol-stake", from: "bad", validatorVote: SOL, lamports: "1" })).toThrow();
    expect(() => stakeRow({ action: "ada-delegate", stakeAddress: "stake1x", poolId: "zz" })).toThrow();
  });

  it("rewardsView validates pending <= lifetime", () => {
    expect(() => rewardsView([{ chain: "c", asset: "SOL", pendingBaseUnits: "10", lifetimeBaseUnits: "5", decimals: 9 }])).toThrow();
  });
});

describe("nft gallery screen", () => {
  const assets = [
    { standard: "erc721", chain: "eip155:1", contract: "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D", tokenId: "1", owner: "0xabc", name: "Ape #1", collectionId: "bayc" },
    { standard: "erc721", chain: "eip155:1", contract: "0x0000000000000000000000000000000000000001", tokenId: "9", owner: "0xabc", name: "FREE AIRDROP CLAIM" },
  ] as const;

  it("hides spam by default, reveals on demand, gates transfer when watch-only", () => {
    const m = nftGalleryModel([...assets], { blocklist: ["bayc"] });
    expect(m.visible).toHaveLength(0);
    expect(m.hiddenCount).toBe(2);
    expect(m.canTransfer).toBe(true);
    const revealed = nftGalleryModel([...assets], { blocklist: ["bayc"], revealed: ["bayc"] });
    expect(revealed.visible).toHaveLength(1);
    const wo = nftGalleryModel([...assets], {}, { watchOnly: true });
    expect(wo.canTransfer).toBe(false);
    expect(wo.chrome.bannerKey).toBe("watchOnly.banner");
    const r = revealCollection([...assets], {}, "0x0000000000000000000000000000000000000001");
    expect(r.reasons.some((x) => x.includes("suspicious name"))).toBe(true);
  });
});

describe("security screen", () => {
  it("duress state machine never stores the pin", () => {
    let m = duressInit(false);
    expect(m.step).toBe("idle");
    m = duressNext(m, {});
    expect(m.step).toBe("confirm-main");
    expect(() => duressNext(m, { mainPassword: "short" })).toThrow();
    m = duressNext(m, { mainPassword: "main-password-1" });
    expect(m.step).toBe("set-pin");
    m = duressNext(m, { pin: "duress-pin-99" });
    expect(m.step).toBe("confirm-pin");
    expect(() => duressNext(m, { pin: "duress-pin-99", confirmPin: "different-1" })).toThrow();
    m = duressNext(m, { pin: "duress-pin-99", confirmPin: "duress-pin-99" });
    expect(m).toEqual({ step: "done", hasDuress: true });
    expect(JSON.stringify(m)).not.toContain("duress-pin-99");
  });

  it("spend limit validation + full security model", () => {
    expect(setSpendLimitCents("50000")).toEqual({ ok: true, cents: "50000" });
    expect(setSpendLimitCents("0")).toEqual({ ok: true, cents: "0" });
    expect(setSpendLimitCents("-5")).toMatchObject({ ok: false });
    expect(setSpendLimitCents(123)).toMatchObject({ ok: false });
    const m = securityScreenModel({
      duress: duressInit(true),
      spendLimitUsdCents: "50000",
      autoLockMs: 300_000,
      revokedOrigins: [{ origin: "https://dapp.example", revokedAt: 1, reason: "spam" }],
      wipeInput: "WIPE",
      watchOnly: true,
    });
    expect(m.autoLock).toEqual({ ok: true, ms: 300_000 });
    expect(m.revoked).toHaveLength(1);
    expect(m.wipe.confirmed).toBe(true);
    expect(m.chrome.canSign).toBe(false);
  });
});
