import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { fileURLToPath } from "url";
import * as schema from "../schema";

// ============================================
// stimulus_profiles — %1RM bands per (stimulus_class, movement_category)
// ============================================
//
// See claude_code_instructions/crossfit_improvements/
//     suggested_working_weight_and_template_history_spec.md.
//
// Default-only seeding: each row is inserted ON CONFLICT DO NOTHING so a
// super-admin's tuned value in production is never overwritten by a redeploy.
// First-deploy / fresh-DB behavior is unchanged — all rows land. To force a
// reset, delete the row in admin (or via SQL) and re-deploy.
//
// Movement categories mirror movements.category in the catalog: 'barbell',
// 'olympic', 'dumbbell', 'kettlebell'. 'oly_metcon' rows only carry a band
// for 'olympic' since the class is olympic-flavored by definition.

interface ProfileSeed {
  stimulusClass: schema.StimulusClass;
  movementCategory: string;
  pctLow: number;
  pctHigh: number;
}

const SEEDS: ProfileSeed[] = [
  // strength_heavy
  { stimulusClass: "strength_heavy", movementCategory: "barbell", pctLow: 0.80, pctHigh: 0.95 },
  { stimulusClass: "strength_heavy", movementCategory: "olympic", pctLow: 0.75, pctHigh: 0.90 },
  { stimulusClass: "strength_heavy", movementCategory: "dumbbell", pctLow: 0.70, pctHigh: 0.85 },
  { stimulusClass: "strength_heavy", movementCategory: "kettlebell", pctLow: 0.70, pctHigh: 0.85 },

  // strength_moderate
  { stimulusClass: "strength_moderate", movementCategory: "barbell", pctLow: 0.65, pctHigh: 0.80 },
  { stimulusClass: "strength_moderate", movementCategory: "olympic", pctLow: 0.60, pctHigh: 0.75 },
  { stimulusClass: "strength_moderate", movementCategory: "dumbbell", pctLow: 0.55, pctHigh: 0.70 },
  { stimulusClass: "strength_moderate", movementCategory: "kettlebell", pctLow: 0.55, pctHigh: 0.70 },

  // short_intense
  { stimulusClass: "short_intense", movementCategory: "barbell", pctLow: 0.55, pctHigh: 0.70 },
  { stimulusClass: "short_intense", movementCategory: "olympic", pctLow: 0.50, pctHigh: 0.65 },
  { stimulusClass: "short_intense", movementCategory: "dumbbell", pctLow: 0.45, pctHigh: 0.60 },
  { stimulusClass: "short_intense", movementCategory: "kettlebell", pctLow: 0.45, pctHigh: 0.60 },

  // moderate_metcon
  { stimulusClass: "moderate_metcon", movementCategory: "barbell", pctLow: 0.50, pctHigh: 0.65 },
  { stimulusClass: "moderate_metcon", movementCategory: "olympic", pctLow: 0.45, pctHigh: 0.60 },
  { stimulusClass: "moderate_metcon", movementCategory: "dumbbell", pctLow: 0.40, pctHigh: 0.55 },
  { stimulusClass: "moderate_metcon", movementCategory: "kettlebell", pctLow: 0.40, pctHigh: 0.55 },

  // long_metcon
  { stimulusClass: "long_metcon", movementCategory: "barbell", pctLow: 0.35, pctHigh: 0.50 },
  { stimulusClass: "long_metcon", movementCategory: "olympic", pctLow: 0.30, pctHigh: 0.45 },
  { stimulusClass: "long_metcon", movementCategory: "dumbbell", pctLow: 0.30, pctHigh: 0.45 },
  { stimulusClass: "long_metcon", movementCategory: "kettlebell", pctLow: 0.30, pctHigh: 0.45 },

  // oly_metcon — only olympic; n/a for the other categories.
  { stimulusClass: "oly_metcon", movementCategory: "olympic", pctLow: 0.40, pctHigh: 0.55 },
];

export async function run() {
  const client = postgres(process.env.DATABASE_URL!);
  const db = drizzle(client, { schema });

  try {
    let inserted = 0;
    for (const seed of SEEDS) {
      const rows = await db
        .insert(schema.stimulusProfiles)
        .values({
          stimulusClass: seed.stimulusClass,
          movementCategory: seed.movementCategory,
          pct1rmLow: seed.pctLow.toString(),
          pct1rmHigh: seed.pctHigh.toString(),
        })
        .onConflictDoNothing({
          target: [
            schema.stimulusProfiles.stimulusClass,
            schema.stimulusProfiles.movementCategory,
          ],
        })
        .returning({ stimulusClass: schema.stimulusProfiles.stimulusClass });
      if (rows.length > 0) inserted++;
    }
    console.log(
      `stimulus_profiles — inserted (new only): ${inserted}, ` +
        `skipped (existing, super-admin-tuned values preserved): ${SEEDS.length - inserted}`
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
