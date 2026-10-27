# Stream D E2E — Swap / Stake / NFT flows (U041–U043)

Status: SPEC for Streams A (mobile UI) and B (extension UI) to wire later.
These are human-readable acceptance flows plus Playwright-style step sketches.
NOT executed by vitest — this file is `*.spec.md` so the `vitest run` suite
ignores it.

Conventions shared by all flows below:
- Money is bigint base units on screen (`Amount` component); no floats.
- Every money-moving screen renders a `PolicyBanner` from the review model
  (`priceImpactTier`, `allowancePlan`, `trustedCheck`, `isSpamNft`).
- Approval uses the U021 approval queue UI (origin + decoded call + simulation
  diff + fee + warnings + Approve/Reject). These specs cover what the screens
  must show, not the components themselves.

---

## Flow S1 — EVM swap with exact approval (U041)

Goal: swap 1 USDC -> WETH on Sepolia via the 0x quote path, exact-amount
allowance, impact < 3% (tier `ok`).

Human steps:
1. Open Home -> Swap. Select sell USDC, buy WETH, amount `1.00`.
2. Assert: quote row shows `buyAmount`, fee, `impact < 3%`, no banner.
3. Tap Review -> approval screen shows:
   - decoded call `swap(sell USDC 1000000 -> buy WETH ~…)`,
   - allowance row `approve exactly 1000000` (NOT infinite),
   - fee + fiat, `PolicyBanner: allow`.
4. Approve with biometric gate. Assert: push `txConfirmed` notification
   arrives (hashedAddr only), activity row flips pending -> confirmed.

Playwright sketch (extension full-page app):

```ts
test("S1 exact-approval swap", async ({ page }) => {
  await page.goto("/swap");
  await page.getByLabel("Sell token").selectOption("USDC");
  await page.getByLabel("Buy token").selectOption("WETH");
  await page.getByLabel("Sell amount").fill("1.00");
  await page.getByRole("button", { name: "Get quote" }).click();
  await expect(page.getByTestId("impact-tier")).toHaveText("ok");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByTestId("allowance-mode")).toHaveText("exact");
  await expect(page.getByTestId("policy-banner")).toHaveText("allow");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("activity-row").first()).toContainText("confirmed", { timeout: 60_000 });
});
```

Model mapping: `buildSwapParams` -> `fetchSwapQuote` (mock transport in
unit tests; gateway 0x proxy in the app) -> `reviewSwap(params, quote,
currentAllowance)` -> approval UI.

## Flow S2 — High-impact + infinite-allowance warnings (U041)

Goal: demonstrate both `warn`/`block` gates fire in the approval UI.

Human steps:
1. Open Swap, pick an illiquid pair / large size so impact >= 10%.
2. Assert: `PolicyBanner: block`, Approve button DISABLED, "why" expander
   cites `price impact … exceeds 10%`.
3. Reduce size so impact lands 3–10%: banner flips to `warn`, Approve enabled
   behind a second confirm checkbox.
4. On the allowance row, toggle "infinite approval": assert a
   type-to-confirm input appears (`reason` string required); without typing,
   `allowancePlan` stays `exact`.

Playwright sketch:

```ts
test("S2 impact block then warn", async ({ page }) => {
  await page.goto("/swap");
  // … select illiquid pair, oversize amount, get quote …
  await expect(page.getByTestId("policy-banner")).toHaveText("block");
  await expect(page.getByRole("button", { name: "Approve" })).toBeDisabled();
  // … reduce size, re-quote …
  await expect(page.getByTestId("policy-banner")).toHaveText("warn");
  await page.getByLabel("Infinite approval").check();
  await expect(page.getByLabel("Reason")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("allowance-mode")).toHaveText("exact"); // no reason typed
});
```

## Flow S3 — SOL stake + delegate + undelegate (U042)

Goal: stake 2 SOL, move delegation, then undelegate on devnet.

Human steps:
1. Open Staking -> Stake SOL. Enter `2`, pick validator from the list.
2. Assert: display row `Stake SOL 2.000000000`, no dust hint (>= 1 SOL).
3. Enter `0.001` instead: assert dust hint `below the recommended 1 SOL…`.
4. Review -> approval shows `validatorVote`, lamports `2000000000`.
5. After confirmation: portfolio rewards row appears
   (`buildRewardsRow`: pending `0`, lifetime grows per epoch).
6. Delegate to a second validator, then Undelegate: assert cooldown hint
   `funds unlock after the cooldown period`.

Playwright sketch:

```ts
test("S3 sol staking lifecycle", async ({ page }) => {
  await page.goto("/staking");
  await page.getByLabel("Amount (SOL)").fill("2");
  await page.getByTestId("validator-row").first().click();
  await expect(page.getByTestId("dust-hint")).toHaveCount(0);
  await page.getByRole("button", { name: "Review stake" }).click();
  await expect(page.getByTestId("policy-banner")).toHaveText("allow");
  // … approve, then delegate + undelegate tabs with same pattern …
  await expect(page.getByTestId("rewards-row")).toBeVisible();
});
```

Model mapping: `buildSolStakeIntent` / `buildSolDelegateIntent` /
`buildSolUndelegateIntent` -> approval UI -> signer -> `buildRewardsRow`.

## Flow S4 — ADA pool delegation (U042)

Goal: delegate a stake address to a pool, then undelegate.

Human steps:
1. Open Staking -> Cardano tab -> Delegate. Paste pool id (56 hex chars).
2. Assert: display row cites `2 ADA key deposit (2000000 lovelace)`.
3. Invalid pool id (`deadbeef`): assert inline validation error, Review disabled.
4. Review -> approval shows pool id + deposit; approve; assert rewards row
   for ADA appears. Undelegate tab cites the refund hint.

Playwright sketch:

```ts
test("S4 ada delegation", async ({ page }) => {
  await page.goto("/staking?chain=cardano");
  await page.getByLabel("Pool ID").fill("deadbeef");
  await expect(page.getByRole("button", { name: "Review" })).toBeDisabled();
  await page.getByLabel("Pool ID").fill("ab".repeat(28));
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByTestId("deposit-hint")).toContainText("2000000");
});
```

## Flow S5 — NFT gallery + spam filter + transfer (U043)

Goal: gallery hides spam by default; legit ERC-721 transfers through approval.

Human steps:
1. Open Collectibles. Assert: `AIRDROP CLAIM` NFT is hidden behind the
   `Spam (3)` toggle; toggling reveals it with a `suspicious name` tag.
2. Open a legit NFT -> Send -> paste destination from the address book
   (`trustedCheck`: unseen address warns `ADDRESS_POISON_UNSEEN`).
3. Review -> approval shows `transferFrom` summary, collection, token id,
   fee; approve; assert activity row.
4. Repeat for an ERC-1155 (amount field, `safeTransferFrom`) and an SPL NFT
   (mint + destination in the dish summary).

Playwright sketch:

```ts
test("S5 nft spam + transfer", async ({ page }) => {
  await page.goto("/collectibles");
  await expect(page.getByTestId("spam-toggle")).toContainText("Spam (3)");
  await expect(page.getByTestId("nft-card-airdrop")).toHaveCount(0);
  await page.getByTestId("spam-toggle").click();
  await expect(page.getByTestId("nft-card-airdrop")).toBeVisible();
  // … open legit NFT, send through approval …
  await expect(page.getByTestId("policy-banner")).toHaveText("warn"); // unseen dest
});
```

Model mapping: `NftAsset`/`NftCollection` -> `isSpamNft` (gallery filter) ->
`buildErc721Transfer` / `buildErc1155Transfer` / `buildSplNftTransfer` ->
U021 approval screen.
