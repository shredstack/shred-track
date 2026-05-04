import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { fileURLToPath } from "url";
import * as schema from "../schema";

// ---------------------------------------------------------------------------
// Extra canonical movements that aren't in the original `src/db/seed.ts` set.
// ---------------------------------------------------------------------------
//
// The local one-shot seed (`src/db/seed.ts`) is the source of truth for new
// dev DBs but doesn't run in production. Anything added there since the last
// prod-seed run must also be idempotently seeded here so production picks it
// up.
//
// File is prefixed with `0_` so it sorts before `benchmarks.ts` in
// `run-all.ts` — benchmarks that reference these movements need them present
// at the time the upsert runs.

type MovementSeed = {
  canonicalName: string;
  category: string;
  isWeighted: boolean;
  is1rmApplicable: boolean;
  metricType?: string;
  commonRxWeightMale?: string;
  commonRxWeightFemale?: string;
};

const extraMovements: MovementSeed[] = [
  // Used by the Drew hero WOD — a burpee with a pull-up at the top.
  {
    canonicalName: "Burpee Pull-Up",
    category: "bodyweight",
    isWeighted: false,
    is1rmApplicable: false,
  },
];

export async function run() {
  const client = postgres(process.env.DATABASE_URL!);
  const db = drizzle(client, { schema });

  try {
    const names = extraMovements.map((m) => m.canonicalName);
    const existing = await db
      .select()
      .from(schema.movements)
      .where(
        and(
          inArray(schema.movements.canonicalName, names),
          isNull(schema.movements.createdBy)
        )
      );
    const byName = new Map(existing.map((m) => [m.canonicalName, m]));

    let created = 0;
    let updated = 0;

    await db.transaction(async (tx) => {
      for (const m of extraMovements) {
        const current = byName.get(m.canonicalName);
        const values = {
          category: m.category,
          isWeighted: m.isWeighted,
          is1rmApplicable: m.is1rmApplicable,
          metricType: m.metricType ?? "reps",
          commonRxWeightMale: m.commonRxWeightMale ?? null,
          commonRxWeightFemale: m.commonRxWeightFemale ?? null,
          isValidated: true,
        };
        if (current) {
          await tx
            .update(schema.movements)
            .set(values)
            .where(eq(schema.movements.id, current.id));
          updated++;
        } else {
          await tx.insert(schema.movements).values({
            canonicalName: m.canonicalName,
            ...values,
            createdBy: null,
          });
          created++;
        }
      }
    });

    console.log(
      `Extra canonical movements — created: ${created}, updated: ${updated} (of ${extraMovements.length})`
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
