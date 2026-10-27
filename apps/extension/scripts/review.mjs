// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// ext:review — manifest allowlist + CSP + no inline script/eval
import fs from "node:fs";
const m = JSON.parse(fs.readFileSync("manifest.chrome.json", "utf8"));
const forbidden = ["<all_urls>", "tabs", "webRequestBlocking", "debugger"];
let fail = 0;
for (const p of m.permissions ?? []) if (forbidden.includes(p)) { console.error(`forbidden permission: ${p}`); fail = 1; }
const csp = m.content_security_policy?.extension_pages ?? "";
if (!csp.includes("script-src 'self'") || csp.includes("unsafe-eval")) { console.error("bad CSP"); fail = 1; }
if (fail === 0) console.log("ext:review ok");
process.exit(fail);
