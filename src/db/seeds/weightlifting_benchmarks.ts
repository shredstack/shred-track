// ---------------------------------------------------------------------------
// Auto-generated weightlifting benchmarks.
//
// One benchmark per 1RM-applicable movement (Back Squat, Deadlift, Power
// Snatch, Hang Clean, …). The "1RM / 2RM / 3RM / 5RM" tabs are derived at
// query time from the athlete's for_load history — no per-rep-max rows.
//
// Idempotent: keyed on movements.id via the partial unique index
// `benchmark_workouts_weightlifting_movement_unique`. Re-running this seed
// after an admin flips `is_1rm_applicable = true` for a new movement adds
// only the new row. Re-running after a movement was renamed updates the
// benchmark name to match.
//
// See claude_code_instructions/weightlifting_benchmarks_spec.md.
// ---------------------------------------------------------------------------

import { config } from "dotenv";
config({ path: ".env.local" });

import { fileURLToPath } from "url";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import * as schema from "../schema";
import { ensureWeightliftingBenchmark } from "@/lib/crossfit/weightlifting-benchmarks";

export async function run() {
  const client = postgres(process.env.DATABASE_URL!);
  const db = drizzle(client, { schema });

  try {
    console.log("Seeding weightlifting benchmarks...");

    const oneRmMovements = await db
      .select({
        id: schema.movements.id,
        canonicalName: schema.movements.canonicalName,
      })
      .from(schema.movements)
      .where(eq(schema.movements.is1rmApplicable, true));

    if (oneRmMovements.length === 0) {
      console.log("  No 1RM-applicable movements found — nothing to seed.");
      return;
    }
    console.log(`  Found ${oneRmMovements.length} 1RM-applicable movement(s).`);

    let upserted = 0;
    for (const m of oneRmMovements) {
      // One transaction per movement so readers never see a half-built
      // benchmark (part inserted but movement row not yet attached).
      await db.transaction(async (tx) => {
        await ensureWeightliftingBenchmark(tx, m);
      });
      console.log(`  OK: ${m.canonicalName}`);
      upserted += 1;
    }

    console.log(`Done! Upserted ${upserted} weightlifting benchmark(s).`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
}
