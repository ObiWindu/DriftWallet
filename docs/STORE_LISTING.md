# Store Listing Checklist (Iteration 2: U054)

Fill one copy per store target (Google Play, App Store, Chrome Web Store, AMO).
Attach the completed checklist + screenshots to the release tag.

## Copy

- [ ] App name + short description (EN; FR/ES translations reviewed by a native speaker)
- [ ] Full description mentions: non-custodial, no seed leaves the device, supported networks
- [ ] "What's new" notes reference the changeset summary, not internal ticket IDs
- [ ] Support URL + security contact (security@drift.example) live

## Screenshots / graphics

- [ ] Mobile: 4+ screenshots per form factor (phone SE-size + tablet), incl. onboarding, home, approval queue, settings
- [ ] Mobile: feature graphic + 1024px icon; no real funds/addresses visible
- [ ] Extension: 1280x800 promo screenshots (popup, approval queue with origin badge, full-page app)
- [ ] Watch-only "view only" banner visible in at least one screenshot (requirement proof)

## Privacy labels / content rating

- [ ] Data-safety / nutrition labels: NO seed/mnemonic/private-key collection declared
- [ ] Disclosed: hashed-address push subscriptions (`sha256(address)`), swap-quote relay via gateway, crash reports (hash-only, no seed)
- [ ] Camera permission string justifies QR receive/scan; no background location
- [ ] Content rating questionnaire completed (financial app, no gambling)

## Pre-submit gates

- [ ] `pnpm run ext:package` green + SHA256SUMS recorded (extension)
- [ ] MV3 `review` green; `PERMISSIONS.md` matches submitted manifest
- [ ] `sbom.json` (+ CycloneDX) + `wasm.SHA256` attached to the release
- [ ] `SECURITY_TEST_EVIDENCE.md` Iteration 2 table filled with CI links
- [ ] Staged rollout stage + bake window noted (1% 24h / 10% 48h / 100%)
