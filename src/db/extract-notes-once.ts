// One-shot dev script that runs the notes-extraction pipeline for a single
// user, bypassing the Inngest cron. Useful for testing Phase 4 end-to-end
// without waiting on a scheduled fire — and for backfilling a year of data
// in one command (the script loops through batches until the queue is empty).
//
// Usage:
//   npx tsx src/db/extract-notes-once.ts <email> [--limit=N] [--max=N]
//
// Examples:
//   npx tsx src/db/extract-notes-once.ts sarah.dorich@gmail.com
//   npx tsx src/db/extract-notes-once.ts sarah.dorich@gmail.com --max=50
//
// Flags:
//   --limit=N   batch size per query (default 50). Just controls how many
//               scores we hold in memory at once; doesn't cap total work.
//   --max=N     hard ceiling on total scores processed across all batches.
//               Useful when you want to extract just a few for inspection.
//
// What it does:
//   1. Looks up the user by email, verifies is_vip = true
//   2. Loops:
//        a. listScoresNeedingExtraction (model_version + content_hash gate)
//        b. for each score, calls Claude, saves with the new content hash
//        c. exits when the queue comes back empty (or --max is hit)
//   3. Prints aggregated insights so you can see what the card will see
//
// Re-running is safe: extractions upsert per score_id. Notes that haven't
// changed (same model_version + same input hash) are skipped automatically.

// Load .env.local BEFORE any module that reads process.env.
import { config } from "dotenv";
config({ path: ".env.local" });

import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "./index";
import { users } from "./schema";
import { eq } from "drizzle-orm";
import {
  NOTES_MODEL_VERSION,
  aggregateNotesForUser,
  extractNoteForScore,
  listScoresNeedingExtraction,
  saveExtraction,
} from "../lib/crossfit/insights/notes-extraction";

function parseFlag(name: string, fallback: number): number {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return fallback;
  const v = parseInt(arg.split("=")[1] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

async function main() {
  const email = process.argv[2];
  if (!email || email.startsWith("--")) {
    console.error(
      "Usage: npx tsx src/db/extract-notes-once.ts <email> [--limit=N] [--max=N]"
    );
    process.exit(1);
  }

  const batchSize = parseFlag("limit", 50);
  const maxTotal = parseFlag("max", Number.POSITIVE_INFINITY);

  console.log(`\n→ Looking up user ${email}...`);
  const [user] = await db
    .select({ id: users.id, name: users.name, isVip: users.isVip })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user) {
    console.error(`No user with email ${email}`);
    process.exit(1);
  }
  if (!user.isVip) {
    console.error(
      `${email} is not a VIP. Run:\n  UPDATE users SET is_vip = true WHERE email = '${email}';`
    );
    process.exit(1);
  }
  console.log(`  ✓ ${user.name} (${user.id}), VIP`);

  console.log(
    `\n→ Extracting (model=${NOTES_MODEL_VERSION}, batch=${batchSize}${
      maxTotal === Number.POSITIVE_INFINITY ? "" : `, max=${maxTotal}`
    })...`
  );

  const client = new Anthropic({ maxRetries: 0 });
  let totalExtracted = 0;
  let totalErrors = 0;
  let batchNum = 0;

  while (totalExtracted + totalErrors < maxTotal) {
    batchNum += 1;
    const remaining = maxTotal - (totalExtracted + totalErrors);
    const queue = await listScoresNeedingExtraction(
      user.id,
      NOTES_MODEL_VERSION,
      Math.min(batchSize, remaining)
    );
    if (queue.length === 0) {
      console.log(
        `  ${batchNum === 1 ? "Nothing to do — already up to date." : "Queue empty — done."}`
      );
      break;
    }

    console.log(`\n  Batch ${batchNum}: ${queue.length} score(s)`);

    for (const note of queue) {
      try {
        const parts: string[] = [];
        if (note.scoreNote) {
          parts.push(
            `score:"${note.scoreNote.slice(0, 50).replace(/\s+/g, " ")}..."`
          );
        }
        const movementNoteCount = note.movements.filter(
          (m) => m.movementNote && m.movementNote.trim().length > 0
        ).length;
        if (movementNoteCount > 0) {
          parts.push(`+${movementNoteCount} mvmt note(s)`);
        }
        if (note.movements.length > 0) {
          parts.push(`(${note.movements.length} mvmt context)`);
        }
        const preview = parts.join(" ") || "(empty?)";
        process.stdout.write(`    · ${note.workoutDate} ${preview} → `);
        const { extraction, contentHash } = await extractNoteForScore(
          note,
          client
        );
        await saveExtraction(
          note.scoreId,
          extraction,
          NOTES_MODEL_VERSION,
          contentHash
        );
        const counts = `${extraction.complaints.length}c/${extraction.scalingRationale.length}s/${extraction.milestones.length}m`;
        process.stdout.write(`${counts}\n`);
        totalExtracted += 1;
      } catch (err) {
        totalErrors += 1;
        const msg = err instanceof Error ? err.message : String(err);
        process.stdout.write(`ERR: ${msg}\n`);
      }
    }
  }

  console.log(
    `\n  ✓ Total extracted: ${totalExtracted}${
      totalErrors > 0 ? `, errors: ${totalErrors}` : ""
    }`
  );

  console.log(`\n→ Aggregated view (what the card will render):`);
  const insights = await aggregateNotesForUser(user.id);
  console.log(JSON.stringify(insights, null, 2));

  console.log("\nDone.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
