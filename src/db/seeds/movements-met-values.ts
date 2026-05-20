import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { fileURLToPath } from "url";
import * as schema from "../schema";
import { MET_SEED_ROWS } from "../../lib/calories/met-seed";

// ---------------------------------------------------------------------------
// movements-met-values — seed MET fields onto system movements.
// ---------------------------------------------------------------------------
//
// MET values are sourced from the 2024 Adult Compendium of Physical Activities
// (Herrmann et al.). The full data table + reasoning lives in
// `src/lib/calories/met-seed.ts` so it can be unit-tested without a DB.
//
// Idempotent — every UPDATE is keyed by (canonical_name, created_by IS NULL).
// User-owned customs are never touched. Re-running converges.
//
// Ordering: must run after `0_extra-movements.ts` and `movements-db-variants.ts`
// (which insert the rows this seed updates). Alphabetical filename order in
// `run-all.ts` already guarantees that.

export async function run() {
  const client = postgres(process.env.DATABASE_URL!);
  const db = drizzle(client, { schema });

  try {
    const allNames = MET_SEED_ROWS.map((r) => r.canonicalName);
    const existing = await db
      .select({
        id: schema.movements.id,
        canonicalName: schema.movements.canonicalName,
      })
      .from(schema.movements)
      .where(
        and(
          inArray(schema.movements.canonicalName, allNames),
          isNull(schema.movements.createdBy)
        )
      );
    const idByName = new Map(existing.map((m) => [m.canonicalName, m.id]));

    let updated = 0;
    let missing = 0;

    await db.transaction(async (tx) => {
      for (const row of MET_SEED_ROWS) {
        const id = idByName.get(row.canonicalName);
        if (!id) {
          missing++;
          continue;
        }
        await tx
          .update(schema.movements)
          .set({
            metValue: row.metValue != null ? String(row.metValue) : null,
            metCompendiumCode: row.metCompendiumCode ?? null,
            metIsEstimated: row.metIsEstimated ?? false,
            metSource: row.metSource ?? "2024 Adult Compendium",
            metNotes: row.metNotes ?? null,
            repSecondsDefault:
              row.repSecondsDefault != null
                ? String(row.repSecondsDefault)
                : null,
            isPacedRun: row.isPacedRun ?? false,
            isPacedErg: row.isPacedErg ?? null,
            metUpdatedAt: new Date(),
          })
          .where(eq(schema.movements.id, id));
        updated++;
      }
    });

    console.log(
      `movements-met-values — updated: ${updated}, missing (skipped): ${missing}`
    );
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
