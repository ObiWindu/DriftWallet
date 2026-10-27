// dump-openapi.mts: snapshot services/gateway/openapi.json from the live route.
// Used by release-consistency CI (regen + git diff must be clean).
// Usage: pnpm --dir services/gateway exec tsx ../../scripts/dump-openapi.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildServer } from "../services/gateway/src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "services/gateway/openapi.json");

async function main(): Promise<void> {
  const app = buildServer();
  const res = await app.inject({ method: "GET", url: "/openapi.json" });
  if (res.statusCode !== 200) throw new Error(`openapi route -> ${res.statusCode}`);
  fs.writeFileSync(out, `${JSON.stringify(res.json(), null, 2)}\n`);
  console.log(`openapi snapshot ok -> ${out}`);
  await app.close();
}

await main();
