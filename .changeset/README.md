# Changesets

Every user-facing change ships with a changeset file in this directory
(`pnpm changeset` for an interactive prompt, or copy the template below).
On `main`, the changesets bot opens a Version PR; merging it tags
`@drift/mobile@x.y.z` / `@drift/extension@x.y.z` for the store release train
(see `RELEASE.md`).

All workspace packages are private (`private: true`), so `changeset version`
records versions + changelogs without npm publishing — the release units are
the store artifacts (AAB/IPA, extension zips), not registry packages.
