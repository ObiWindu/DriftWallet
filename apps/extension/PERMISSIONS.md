# DriftWallet Extension — MV3 Permissions (T010)

Manifests: `manifest.chrome.json`, `manifest.firefox.json`.
Review gate: `pnpm --filter ./apps/extension review` (see `scripts/review.mjs`).

## Granted permissions

| Permission | Why it is needed | What breaks without it |
|---|---|---|
| `storage` | Persist non-secret state only: permission grants, approval history metadata, settings. Never seeds/keys (see `SECURITY_TEST_EVIDENCE.md`). | Settings + connected-site list cannot persist. |
| `alarms` | Auto-lock timer + session expiry (service workers cannot use `setTimeout` reliably). | Wallet would stay unlocked indefinitely. |
| `offscreen` | Run the signer WASM in an offscreen document (MV3 SW has no DOM/WASM-threads). Session handle lives in memory only (`src/offscreen.ts`). | No signing at all under MV3. |
| `activeTab` | Show the requesting origin/title in the approval popup for the tab being acted on. Scoped to the active tab at invoke time. | Approval screen cannot display verified origin context. |

## Deliberately NOT requested

- **`<all_urls>`** — never injected. Content scripts declare explicit matches per
  dapp (reviewed in `reviewManifest()` in `src/background.ts`); broad host access
  would let a compromised build read every page. The review script fails the
  build if `<all_urls>` appears in `permissions` or `content_scripts`.
- **`tabs`** — full tab URLs/titles are unnecessary; `activeTab` covers the
  approval-origin display.
- **`webRequest` / `webRequestBlocking`** — no traffic interception; gateway
  calls go over `fetch` to the pinned gateway origin only.
- **`debugger`** — would allow code injection into pages; prohibited.
- **`bookmarks` / `history` / `cookies`** — unrelated to wallet function.

## CSP

`content_security_policy.extension_pages`:
`script-src 'self'; object-src 'none'; connect-src https://gateway.drift.example`

- No `unsafe-eval`, no `unsafe-inline`, no remote code.
- Injected provider shims (`src/injected.ts`) are static template strings —
  no `eval`, no `new Function`, no fetched code.
- Gateway origin allowlist only; dapp RPC arrives via `postMessage`, not fetch.
