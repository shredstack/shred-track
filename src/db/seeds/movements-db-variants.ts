import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { fileURLToPath } from "url";
import * as schema from "../schema";

// ============================================
// DB-prefixed dumbbell variants
// ============================================
//
// Idiom in CrossFit notation: "Deadlift" means barbell; "DB Deadlift" means
// dumbbells. This seeds a dumbbell counterpart for every barbell lift so the
// builder library exposes both.
//
// Idempotent: re-runs upsert by (canonical_name, created_by IS NULL) and
// update non-key fields if the definition changed.

type DbVariantSeed = {
  canonicalName: string;
  isWeighted: boolean;
  is1rmApplicable: boolean;
  commonRxWeightMale?: string;
  commonRxWeightFemale?: string;
};

const variants: DbVariantSeed[] = [
  { canonicalName: "DB Back Squat", isWeighted: true, is1rmApplicable: false },
  { canonicalName: "DB Front Squat", isWeighted: true, is1rmApplicable: false },
  { canonicalName: "DB Overhead Squat", isWeighted: true, is1rmApplicable: false },
  { canonicalName: "DB Deadlift", isWeighted: true, is1rmApplicable: false, commonRxWeightMale: "50", commonRxWeightFemale: "35" },
  { canonicalName: "DB Sumo Deadlift High Pull", isWeighted: true, is1rmApplicable: false },
  { canonicalName: "DB Clean", isWeighted: true, is1rmApplicable: false, commonRxWeightMale: "50", commonRxWeightFemale: "35" },
  { canonicalName: "DB Power Clean", isWeighted: true, is1rmApplicable: false, commonRxWeightMale: "50", commonRxWeightFemale: "35" },
  { canonicalName: "DB Squat Clean", isWeighted: true, is1rmApplicable: false },
  { canonicalName: "DB Hang Clean", isWeighted: true, is1rmApplicable: false },
  { canonicalName: "DB Hang Power Clean", isWeighted: true, is1rmApplicable: false },
  { canonicalName: "DB Clean and Jerk", isWeighted: true, is1rmApplicable: false, commonRxWeightMale: "50", commonRxWeightFemale: "35" },
  { canonicalName: "DB Snatch", isWeighted: true, is1rmApplicable: false, commonRxWeightMale: "50", commonRxWeightFemale: "35" },
  { canonicalName: "DB Power Snatch", isWeighted: true, is1rmApplicable: false, commonRxWeightMale: "50", commonRxWeightFemale: "35" },
  { canonicalName: "DB Squat Snatch", isWeighted: true, is1rmApplicable: false },
  { canonicalName: "DB Hang Snatch", isWeighted: true, is1rmApplicable: false },
  { canonicalName: "DB Hang Power Snatch", isWeighted: true, is1rmApplicable: false },
  { canonicalName: "DB Thruster", isWeighted: true, is1rmApplicable: false, commonRxWeightMale: "50", commonRxWeightFemale: "35" },
  { canonicalName: "DB Push Press", isWeighted: true, is1rmApplicable: false },
  { canonicalName: "DB Push Jerk", isWeighted: true, is1rmApplicable: false },
  { canonicalName: "DB Split Jerk", isWeighted: true, is1rmApplicable: false },
  { canonicalName: "DB Shoulder Press", isWeighted: true, is1rmApplicable: false },
  { canonicalName: "DB Bench Press", isWeighted: true, is1rmApplicable: false },
  { canonicalName: "DB Overhead Press", isWeighted: true, is1rmApplicable: false },
  { canonicalName: "DB Row", isWeighted: true, is1rmApplicable: false, commonRxWeightMale: "50", commonRxWeightFemale: "35" },
  { canonicalName: "DB Cluster", isWeighted: true, is1rmApplicable: false },
];

export async function run() {
  const client = postgres(process.env.DATABASE_URL!);
  const db = drizzle(client, { schema });

  try {
    const names = variants.map((v) => v.canonicalName);

    // Fetch existing rows keyed by name so we can tell insert from update.
    const existing = await db
      .select()
      .from(schema.movements)
      .where(
        and(inArray(schema.movements.canonicalName, names), isNull(schema.movements.createdBy))
      );
    const byName = new Map(existing.map((m) => [m.canonicalName, m]));

    let created = 0;
    let updated = 0;

    await db.transaction(async (tx) => {
      for (const v of variants) {
        const current = byName.get(v.canonicalName);
        if (current) {
          await tx
            .update(schema.movements)
            .set({
              category: "dumbbell",
              isWeighted: v.isWeighted,
              is1rmApplicable: v.is1rmApplicable,
              commonRxWeightMale: v.commonRxWeightMale ?? null,
              commonRxWeightFemale: v.commonRxWeightFemale ?? null,
            })
            .where(eq(schema.movements.id, current.id));
          updated++;
        } else {
          await tx.insert(schema.movements).values({
            canonicalName: v.canonicalName,
            category: "dumbbell",
            isWeighted: v.isWeighted,
            is1rmApplicable: v.is1rmApplicable,
            commonRxWeightMale: v.commonRxWeightMale ?? null,
            commonRxWeightFemale: v.commonRxWeightFemale ?? null,
            createdBy: null,
          });
          created++;
        }
      }
    });

    console.log(`DB dumbbell variants — created: ${created}, updated: ${updated} (of ${variants.length})`);
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
