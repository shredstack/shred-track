import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, isNull, and, inArray, sql } from "drizzle-orm";
import { fileURLToPath } from "url";
import * as schema from "../schema";

// ============================================
// movements-rx-settings — Phase 2 movement settings backfill
// ============================================
//
// Convergence layer for the rx_fields / rx_defaults / supported_metric_types
// columns added by `20260505120000_movement_rx_settings.sql`. The migration
// does the initial backfill on the system movements that exist at migration
// time; this seed is what keeps every fresh prod DB (and every developer's
// local DB) in sync as we tweak defaults or add new system movements.
//
// Idempotent — every UPDATE is keyed by (canonical_name, created_by IS NULL),
// so re-running converges. Only system rows are touched; user-owned customs
// are never overwritten.
//
// Naming note: this file sorts AFTER `movements-db-variants.ts` so DB variants
// created by that seed get their Rx settings applied on the same run.

type MetricType = "reps" | "weight" | "calories" | "distance" | "duration";
type RxField = "weight" | "weight_bw" | "height" | "calories" | "distance" | "duration" | "tempo";

interface RxSettingsSeed {
  canonicalNames: string[];
  supportedMetricTypes?: MetricType[];
  rxFields: RxField[];
  rxDefaults?: Record<string, number | string>;
}

// Per-spec defaults: gendered weight pairs for known barbell / DB / KB
// movements; gendered height pairs for box jumps. These mirror the values
// applied in the migration so a fresh DB without the migration's UPDATE
// statements still ends up correct after seeds run.
const SEEDS: RxSettingsSeed[] = [
  // ---------- Barbell 95/65 ----------
  {
    canonicalNames: ["Thruster", "Push Press", "Push Jerk", "Shoulder Press", "Overhead Press"],
    supportedMetricTypes: ["reps", "weight"],
    rxFields: ["weight"],
    rxDefaults: { weight_male: 95, weight_female: 65 },
  },
  // ---------- Barbell 135/95 ----------
  {
    canonicalNames: [
      "Clean",
      "Power Clean",
      "Squat Clean",
      "Hang Clean",
      "Hang Power Clean",
      "Snatch",
      "Power Snatch",
      "Squat Snatch",
      "Hang Snatch",
      "Hang Power Snatch",
      "Clean and Jerk",
      "Split Jerk",
      "Front Squat",
      "Back Squat",
      "Bench Press",
      "Overhead Squat",
      "Sumo Deadlift High Pull",
    ],
    supportedMetricTypes: ["reps", "weight"],
    rxFields: ["weight"],
    rxDefaults: { weight_male: 135, weight_female: 95 },
  },
  // ---------- Deadlift 225/155 ----------
  {
    canonicalNames: ["Deadlift"],
    supportedMetricTypes: ["reps", "weight"],
    rxFields: ["weight"],
    rxDefaults: { weight_male: 225, weight_female: 155 },
  },
  // ---------- Wall Ball 20/14 ----------
  {
    canonicalNames: ["Wall Ball"],
    supportedMetricTypes: ["reps", "weight"],
    rxFields: ["weight"],
    rxDefaults: { weight_male: 20, weight_female: 14 },
  },
  // ---------- Kettlebell 53/35 ----------
  {
    canonicalNames: [
      "Kettlebell Swing",
      "Goblet Squat",
      "Kettlebell Clean",
      "Kettlebell Snatch",
      "Kettlebell Turkish Get-Up",
    ],
    supportedMetricTypes: ["reps", "weight"],
    rxFields: ["weight"],
    rxDefaults: { weight_male: 53, weight_female: 35 },
  },
  // ---------- Dumbbell 50/35 ----------
  {
    canonicalNames: [
      "DB Snatch",
      "DB Power Snatch",
      "DB Clean",
      "DB Power Clean",
      "DB Clean and Jerk",
      "DB Hang Power Clean",
      "DB Thruster",
      "DB Deadlift",
      "DB Row",
      "DB Push Press",
      "DB Push Jerk",
      "DB Shoulder Press",
      "DB Bench Press",
      "DB Overhead Press",
      "Devil Press",
      "Dumbbell Snatch",
      "Dumbbell Clean",
      "Dumbbell Thruster",
      "Dumbbell Hang Clean and Jerk",
      "Dumbbell Lunge",
      "Dumbbell Shoulder to Overhead",
      "Man Maker",
      "Turkish Get-Up",
    ],
    supportedMetricTypes: ["reps", "weight"],
    rxFields: ["weight"],
    rxDefaults: { weight_male: 50, weight_female: 35 },
  },
  // ---------- Other DB lifts (no specific default — just declare the field) ----------
  {
    canonicalNames: [
      "DB Back Squat",
      "DB Front Squat",
      "DB Overhead Squat",
      "DB Sumo Deadlift High Pull",
      "DB Squat Clean",
      "DB Hang Clean",
      "DB Hang Snatch",
      "DB Hang Power Snatch",
      "DB Squat Snatch",
      "DB Split Jerk",
      "DB Cluster",
      "Cluster",
      "Barbell Lunge",
      "Barbell Row",
    ],
    supportedMetricTypes: ["reps", "weight"],
    rxFields: ["weight"],
  },
  // ---------- Farmers Carry 70/53 ----------
  {
    canonicalNames: ["Farmers Carry"],
    supportedMetricTypes: ["reps", "weight"],
    rxFields: ["weight"],
    rxDefaults: { weight_male: 70, weight_female: 53 },
  },
  // ---------- Other monostructural-weight (sled work) ----------
  {
    canonicalNames: ["Sled Push", "Sled Pull", "Sandbag Lunges"],
    supportedMetricTypes: ["reps", "weight"],
    rxFields: ["weight"],
  },
  // ---------- Box jumps & step-ups (gendered 24/20 height) ----------
  {
    canonicalNames: ["Box Jump", "Box Step-Up", "Burpee Box Jump Over"],
    supportedMetricTypes: ["reps"],
    rxFields: ["height"],
    rxDefaults: { height_inches_male: 24, height_inches_female: 20 },
  },
  // ---------- Deficit pushup / HSPU (4" gender-agnostic) ----------
  {
    canonicalNames: ["Deficit Push-Up", "Deficit Handstand Push-Up"],
    supportedMetricTypes: ["reps"],
    rxFields: ["height"],
    rxDefaults: { height_inches_male: 4, height_inches_female: 4 },
  },
  // ---------- Dumbbell Box Step-Up: weight + height ----------
  {
    canonicalNames: ["Dumbbell Box Step-Up"],
    supportedMetricTypes: ["reps", "weight"],
    rxFields: ["weight", "height"],
    rxDefaults: {
      weight_male: 50,
      weight_female: 35,
      height_inches_male: 24,
      height_inches_female: 20,
    },
  },
  // ---------- Cardio: cal & distance ----------
  {
    canonicalNames: ["Row", "SkiErg", "Bike (Assault)", "Bike (Echo)"],
    supportedMetricTypes: ["calories", "distance"],
    rxFields: ["calories"],
  },
  // ---------- Run: distance & duration ----------
  {
    canonicalNames: ["Run"],
    supportedMetricTypes: ["distance", "duration"],
    rxFields: ["distance"],
  },
  // ---------- Duration-only holds ----------
  {
    canonicalNames: [
      "Plank",
      "Hollow Hold",
      "L-Sit",
      "Wall Sit",
      "Handstand Hold",
      "Dead Hang",
    ],
    supportedMetricTypes: ["duration"],
    rxFields: ["duration"],
  },
  // ---------- Rest (legacy single-input, intentionally empty rxFields) ----------
  // The MovementListBuilder detects Rest via `rxFields.length === 0 &&
  // supportedMetricTypes.includes('duration')` and renders a single
  // non-gendered "Rest duration" input.
  {
    canonicalNames: ["Rest"],
    supportedMetricTypes: ["duration"],
    rxFields: [],
  },
];

export async function run() {
  const client = postgres(process.env.DATABASE_URL!);
  const db = drizzle(client, { schema });

  try {
    // Flatten so we can pre-fetch existing rows in one query.
    const allNames = SEEDS.flatMap((s) => s.canonicalNames);
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
      for (const seed of SEEDS) {
        for (const name of seed.canonicalNames) {
          const id = idByName.get(name);
          if (!id) {
            missing++;
            continue;
          }
          const updates: Record<string, unknown> = {
            rxFields: seed.rxFields,
            rxDefaults: seed.rxDefaults ?? {},
          };
          if (seed.supportedMetricTypes) {
            updates.supportedMetricTypes = seed.supportedMetricTypes;
          }
          await tx
            .update(schema.movements)
            .set(updates)
            .where(eq(schema.movements.id, id));
          updated++;
        }
      }

      // Catch-all: any remaining system movement with default supported
      // metric types should at least carry its own metric_type. This makes
      // brand-new system movements (added without an explicit seed entry)
      // show up correctly in the builder via the metricType lookup, even
      // before someone updates this file.
      await tx.execute(sql`
        UPDATE movements
        SET supported_metric_types = ARRAY[metric_type]
        WHERE created_by IS NULL
          AND supported_metric_types = ARRAY['reps']::text[]
          AND metric_type != 'reps'
      `);
    });

    console.log(
      `movements-rx-settings — updated: ${updated}, missing (skipped): ${missing}`
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
