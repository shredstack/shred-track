// ---------------------------------------------------------------------------
// Seed runner — executes every seed in this directory in sequence.
//
// Used by the GitHub Actions deploy workflow to apply seeds to production.
// Each seed must export a `run()` function and must be idempotent.
//
// Usage: npm run db:seed:deploy
// ---------------------------------------------------------------------------

import { config } from "dotenv";
config({ path: ".env.local" });

import { readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  const files = readdirSync(__dirname)
    .filter((f) => f.endsWith(".ts") && f !== "run-all.ts")
    .sort();

  if (files.length === 0) {
    console.log("No seeds found.");
    return;
  }

  console.log(`Running ${files.length} seed(s): ${files.join(", ")}\n`);

  for (const file of files) {
    console.log(`── ${file} ──`);
    const mod = await import(pathToFileURL(join(__dirname, file)).href);
    if (typeof mod.run !== "function") {
      throw new Error(`Seed ${file} does not export a run() function`);
    }
    await mod.run();
    console.log();
  }

  console.log("All seeds completed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
