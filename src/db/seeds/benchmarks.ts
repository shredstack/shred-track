import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and } from "drizzle-orm";
import { fileURLToPath } from "url";
import * as schema from "../schema";
import {
  buildFingerprintInput,
  insertTemplateParts,
  type TemplatePartInput,
} from "../../lib/crossfit/upsert-template";
import { computeWorkoutFingerprint } from "../../lib/crossfit/fingerprint";

// ============================================
// Benchmark definitions keyed by movement canonical names
// ============================================

// Source-of-truth for system benchmark categories. Mirrors the CHECK
// constraint on benchmark_workouts.category — keep in sync.
type BenchmarkCategory =
  | "girls"
  | "heroes"
  | "open"
  | "weightlifting"
  | "gym_benchmark";

type BenchmarkMovementSeed = {
  canonicalName: string;
  prescribedReps?: string;
  prescribedWeightMale?: number;
  prescribedWeightFemale?: number;
  rxStandard?: string;
  notes?: string;
};

type BenchmarkPartSeed = {
  label?: string;
  workoutType: string;
  timeCapSeconds?: number;
  amrapDurationSeconds?: number;
  emomIntervalSeconds?: number;
  repScheme?: string;
  rounds?: number;
  notes?: string;
  movements: BenchmarkMovementSeed[];
};

// A benchmark seed is *either* the legacy single-part shape (movements +
// flat type/timing fields) *or* the multi-part shape (parts: [...]).
// Multi-part takes precedence — when both are provided the upsert ignores
// the flat fields and uses parts only.
type BenchmarkSeed = {
  name: string;
  description?: string;
  category: BenchmarkCategory;
  // Workout-level vest prescription. Set on Murph, Chad, etc. so the
  // builder, score-entry, and benchmark match all see it as first-class
  // data instead of buried in the description.
  requiresVest?: boolean;
  vestWeightMaleLb?: number;
  vestWeightFemaleLb?: number;
  isPartner?: boolean;
  partnerCount?: number;
} & (
  | {
      // Legacy single-part shape.
      workoutType: string;
      timeCapSeconds?: number;
      amrapDurationSeconds?: number;
      repScheme?: string;
      movements: BenchmarkMovementSeed[];
      parts?: undefined;
    }
  | {
      // Multi-part shape (Drew, etc.). The first part's
      // workoutType/timeCap/repScheme is mirrored to the legacy top-level
      // columns on benchmark_workouts so older read paths keep working.
      parts: BenchmarkPartSeed[];
      // These fields are not allowed on multi-part seeds — flat
      // workoutType / movements would be ambiguous. Disallowed via the
      // discriminated union above.
      workoutType?: undefined;
      timeCapSeconds?: undefined;
      amrapDurationSeconds?: undefined;
      repScheme?: undefined;
      movements?: undefined;
    }
);

function normalizeToParts(seed: BenchmarkSeed): BenchmarkPartSeed[] {
  if (seed.parts) return seed.parts;
  return [
    {
      workoutType: seed.workoutType,
      timeCapSeconds: seed.timeCapSeconds,
      amrapDurationSeconds: seed.amrapDurationSeconds,
      repScheme: seed.repScheme,
      movements: seed.movements,
    },
  ];
}

const benchmarkSeeds: BenchmarkSeed[] = [
  // ============================================
  // The Girls
  // ============================================
  {
    name: "Fran",
    description: "One of the original CrossFit benchmark workouts. A short, intense couplet.",
    workoutType: "for_time",
    repScheme: "21-15-9",
    category: "girls",
    movements: [
      { canonicalName: "Thruster", prescribedReps: "21-15-9", prescribedWeightMale: 95, prescribedWeightFemale: 65 },
      { canonicalName: "Pull-Up", prescribedReps: "21-15-9" },
    ],
  },
  {
    name: "Grace",
    description: "30 clean and jerks for time. A true test of barbell cycling speed.",
    workoutType: "for_time",
    repScheme: "30 reps",
    category: "girls",
    movements: [
      { canonicalName: "Clean and Jerk", prescribedReps: "30", prescribedWeightMale: 135, prescribedWeightFemale: 95 },
    ],
  },
  {
    name: "Isabel",
    description: "30 snatches for time. Grace's Olympic lifting counterpart.",
    workoutType: "for_time",
    repScheme: "30 reps",
    category: "girls",
    movements: [
      { canonicalName: "Snatch", prescribedReps: "30", prescribedWeightMale: 135, prescribedWeightFemale: 95 },
    ],
  },
  {
    name: "Helen",
    description: "A classic triplet combining running, kettlebell swings, and pull-ups.",
    workoutType: "for_time",
    repScheme: "3 rounds",
    category: "girls",
    movements: [
      { canonicalName: "Run", prescribedReps: "400m" },
      { canonicalName: "Kettlebell Swing", prescribedReps: "21", prescribedWeightMale: 53, prescribedWeightFemale: 35 },
      { canonicalName: "Pull-Up", prescribedReps: "12" },
    ],
  },
  {
    name: "Diane",
    description: "A fast couplet of deadlifts and handstand push-ups.",
    workoutType: "for_time",
    repScheme: "21-15-9",
    category: "girls",
    movements: [
      { canonicalName: "Deadlift", prescribedReps: "21-15-9", prescribedWeightMale: 225, prescribedWeightFemale: 155 },
      { canonicalName: "Handstand Push-Up", prescribedReps: "21-15-9" },
    ],
  },
  {
    name: "Elizabeth",
    description: "A couplet of cleans and ring dips.",
    workoutType: "for_time",
    repScheme: "21-15-9",
    category: "girls",
    movements: [
      { canonicalName: "Clean", prescribedReps: "21-15-9", prescribedWeightMale: 135, prescribedWeightFemale: 95 },
      { canonicalName: "Ring Dip", prescribedReps: "21-15-9" },
    ],
  },
  {
    name: "Annie",
    description: "A descending couplet of double-unders and sit-ups.",
    workoutType: "for_time",
    repScheme: "50-40-30-20-10",
    category: "girls",
    movements: [
      { canonicalName: "Double-Under", prescribedReps: "50-40-30-20-10" },
      { canonicalName: "Sit-Up", prescribedReps: "50-40-30-20-10" },
    ],
  },
  {
    name: "Karen",
    description: "150 wall balls for time. Simple but brutal.",
    workoutType: "for_time",
    repScheme: "150 reps",
    category: "girls",
    movements: [
      { canonicalName: "Wall Ball", prescribedReps: "150", prescribedWeightMale: 20, prescribedWeightFemale: 14 },
    ],
  },
  {
    name: "Jackie",
    description: "A classic triplet: row, thrusters, pull-ups.",
    workoutType: "for_time",
    category: "girls",
    movements: [
      { canonicalName: "Row", prescribedReps: "1000m" },
      { canonicalName: "Thruster", prescribedReps: "50", prescribedWeightMale: 45, prescribedWeightFemale: 35 },
      { canonicalName: "Pull-Up", prescribedReps: "30" },
    ],
  },
  {
    name: "Nancy",
    description: "5 rounds of running and overhead squats.",
    workoutType: "for_time",
    repScheme: "5 rounds",
    category: "girls",
    movements: [
      { canonicalName: "Run", prescribedReps: "400m" },
      { canonicalName: "Overhead Squat", prescribedReps: "15", prescribedWeightMale: 95, prescribedWeightFemale: 65 },
    ],
  },
  {
    name: "Kelly",
    description: "5 rounds of running, box jumps, and wall balls.",
    workoutType: "for_time",
    repScheme: "5 rounds",
    category: "girls",
    movements: [
      { canonicalName: "Run", prescribedReps: "400m" },
      { canonicalName: "Box Jump", prescribedReps: "30", notes: "24/20 inch box" },
      { canonicalName: "Wall Ball", prescribedReps: "30", prescribedWeightMale: 20, prescribedWeightFemale: 14 },
    ],
  },
  {
    name: "Cindy",
    description: "As many rounds as possible of the classic bodyweight triplet.",
    workoutType: "amrap",
    amrapDurationSeconds: 1200,
    category: "girls",
    movements: [
      { canonicalName: "Pull-Up", prescribedReps: "5" },
      { canonicalName: "Push-Up", prescribedReps: "10" },
      { canonicalName: "Air Squat", prescribedReps: "15" },
    ],
  },
  {
    name: "Mary",
    description: "AMRAP 20 of handstand push-ups, pistols, and pull-ups.",
    workoutType: "amrap",
    amrapDurationSeconds: 1200,
    category: "girls",
    movements: [
      { canonicalName: "Handstand Push-Up", prescribedReps: "5" },
      { canonicalName: "Pistol Squat", prescribedReps: "10" },
      { canonicalName: "Pull-Up", prescribedReps: "15" },
    ],
  },
  {
    name: "Chelsea",
    description: "EMOM 30 minutes: pull-ups, push-ups, and air squats every minute.",
    workoutType: "emom",
    timeCapSeconds: 1800,
    category: "girls",
    movements: [
      { canonicalName: "Pull-Up", prescribedReps: "5" },
      { canonicalName: "Push-Up", prescribedReps: "10" },
      { canonicalName: "Air Squat", prescribedReps: "15" },
    ],
  },

  // ============================================
  // Hero WODs
  // ============================================
  {
    name: "Murph",
    description: "In honor of Navy Lt. Michael Murphy.",
    workoutType: "for_time",
    category: "heroes",
    requiresVest: true,
    vestWeightMaleLb: 20,
    vestWeightFemaleLb: 14,
    movements: [
      { canonicalName: "Run", prescribedReps: "1 mile" },
      { canonicalName: "Pull-Up", prescribedReps: "100" },
      { canonicalName: "Push-Up", prescribedReps: "200" },
      { canonicalName: "Air Squat", prescribedReps: "300" },
      { canonicalName: "Run", prescribedReps: "1 mile", notes: "Finish with a 1-mile run" },
    ],
  },
  {
    name: "Half Murph",
    description: "Half of Murph. A common scaled version for rest days or shorter sessions.",
    workoutType: "for_time",
    category: "heroes",
    // Half is typically without the vest; defaults still surface in the
    // builder if the user wants to add one.
    requiresVest: false,
    vestWeightMaleLb: 20,
    vestWeightFemaleLb: 14,
    movements: [
      { canonicalName: "Run", prescribedReps: "800m" },
      { canonicalName: "Pull-Up", prescribedReps: "50" },
      { canonicalName: "Push-Up", prescribedReps: "100" },
      { canonicalName: "Air Squat", prescribedReps: "150" },
      { canonicalName: "Run", prescribedReps: "800m", notes: "Finish with an 800m run" },
    ],
  },
  {
    name: "DT",
    description: "In honor of USAF SSgt Timothy P. Davis. 5 rounds of barbell work.",
    workoutType: "for_time",
    repScheme: "5 rounds",
    category: "heroes",
    movements: [
      { canonicalName: "Deadlift", prescribedReps: "12", prescribedWeightMale: 155, prescribedWeightFemale: 105 },
      { canonicalName: "Hang Power Clean", prescribedReps: "9", prescribedWeightMale: 155, prescribedWeightFemale: 105 },
      { canonicalName: "Push Jerk", prescribedReps: "6", prescribedWeightMale: 155, prescribedWeightFemale: 105 },
    ],
  },
  {
    name: "Nate",
    description: "In honor of Chief Petty Officer Nate Hardy. AMRAP of gymnastics and KB work.",
    workoutType: "amrap",
    amrapDurationSeconds: 1200,
    category: "heroes",
    movements: [
      { canonicalName: "Muscle-Up", prescribedReps: "2" },
      { canonicalName: "Handstand Push-Up", prescribedReps: "4" },
      { canonicalName: "Kettlebell Swing", prescribedReps: "8", prescribedWeightMale: 70, prescribedWeightFemale: 53 },
    ],
  },
  {
    name: "JT",
    description: "In honor of Petty Officer 1st Class Jeff Taylor. Gymnastics push triplet.",
    workoutType: "for_time",
    repScheme: "21-15-9",
    category: "heroes",
    movements: [
      { canonicalName: "Handstand Push-Up", prescribedReps: "21-15-9" },
      { canonicalName: "Ring Dip", prescribedReps: "21-15-9" },
      { canonicalName: "Push-Up", prescribedReps: "21-15-9" },
    ],
  },
  {
    name: "Kalsu",
    description: "In honor of 1st Lt. James Robert Kalsu. 100 thrusters for time, with 5 burpees at the top of every minute (starting at minute 0).",
    workoutType: "for_time",
    repScheme: "100 reps",
    category: "heroes",
    movements: [
      { canonicalName: "Thruster", prescribedReps: "100", prescribedWeightMale: 135, prescribedWeightFemale: 95 },
      { canonicalName: "Burpee", prescribedReps: "5 at top of every minute (incl. 0:00)" },
    ],
  },
  {
    name: "Holleyman",
    description: "In honor of USAF SSgt James Holleyman. 30 rounds for time — wall balls, HSPU, power clean.",
    workoutType: "for_time",
    repScheme: "30 rounds",
    category: "heroes",
    movements: [
      { canonicalName: "Wall Ball", prescribedReps: "5", prescribedWeightMale: 20, prescribedWeightFemale: 14 },
      { canonicalName: "Handstand Push-Up", prescribedReps: "3" },
      { canonicalName: "Power Clean", prescribedReps: "1", prescribedWeightMale: 225, prescribedWeightFemale: 155 },
    ],
  },
  {
    name: "Chad",
    description: "In honor of Navy SEAL Lt. Cmdr. Chad Wilkinson. 1,000 step-ups for time.",
    workoutType: "for_time",
    repScheme: "1000 reps",
    category: "heroes",
    requiresVest: true,
    vestWeightMaleLb: 20,
    vestWeightFemaleLb: 14,
    movements: [
      { canonicalName: "Box Step-Up", prescribedReps: "1000", notes: "20 inch box. 45/35 lb ruck is also acceptable." },
    ],
  },
  {
    // First multi-part hero WOD seeded after benchmarks gained a parts[]
    // schema. Drew is structurally three sections — two identical 3-round
    // chippers split by an 800m run — which is exactly what the legacy
    // single-part shape couldn't express.
    name: "Drew",
    description:
      "In honor of Petty Officer 3rd Class Drew. Three sections: a 3-round chipper, an 800m run, then the same 3-round chipper again.",
    category: "heroes",
    parts: [
      {
        label: "Block 1",
        workoutType: "for_time",
        rounds: 3,
        movements: [
          { canonicalName: "Run", prescribedReps: "400m" },
          { canonicalName: "Box Jump", prescribedReps: "11", notes: "24/20 inch box" },
          {
            canonicalName: "Thruster",
            prescribedReps: "7",
            prescribedWeightMale: 95,
            prescribedWeightFemale: 65,
          },
          { canonicalName: "Burpee Pull-Up", prescribedReps: "4" },
        ],
      },
      {
        label: "Run",
        workoutType: "for_time",
        movements: [
          { canonicalName: "Run", prescribedReps: "800m" },
        ],
      },
      {
        label: "Block 2",
        workoutType: "for_time",
        rounds: 3,
        movements: [
          { canonicalName: "Run", prescribedReps: "400m" },
          { canonicalName: "Box Jump", prescribedReps: "11", notes: "24/20 inch box" },
          {
            canonicalName: "Thruster",
            prescribedReps: "7",
            prescribedWeightMale: 95,
            prescribedWeightFemale: 65,
          },
          { canonicalName: "Burpee Pull-Up", prescribedReps: "4" },
        ],
      },
    ],
  },

  // ============================================
  // Common Gym Benchmarks
  // ============================================
  {
    name: "Fight Gone Bad",
    description: "3 rounds, 1 minute at each station, 1 minute rest between rounds. Score is total reps.",
    workoutType: "for_reps",
    repScheme: "3 rounds",
    category: "gym_benchmark",
    movements: [
      { canonicalName: "Wall Ball", prescribedReps: "1 min", prescribedWeightMale: 20, prescribedWeightFemale: 14 },
      { canonicalName: "Sumo Deadlift High Pull", prescribedReps: "1 min", prescribedWeightMale: 75, prescribedWeightFemale: 55 },
      { canonicalName: "Box Jump", prescribedReps: "1 min", notes: "20 inch box" },
      { canonicalName: "Push Press", prescribedReps: "1 min", prescribedWeightMale: 75, prescribedWeightFemale: 55 },
      { canonicalName: "Row", prescribedReps: "1 min (calories)" },
    ],
  },
  {
    name: "Filthy Fifty",
    description: "50 reps of 10 movements for time. A long chipper.",
    workoutType: "for_time",
    repScheme: "50 reps each",
    category: "gym_benchmark",
    movements: [
      { canonicalName: "Box Jump", prescribedReps: "50", notes: "24 inch box" },
      { canonicalName: "Pull-Up", prescribedReps: "50", notes: "Jumping pull-ups" },
      { canonicalName: "Kettlebell Swing", prescribedReps: "50", prescribedWeightMale: 35, prescribedWeightFemale: 26 },
      { canonicalName: "Walking Lunge", prescribedReps: "50" },
      { canonicalName: "Knees-to-Elbow", prescribedReps: "50" },
      { canonicalName: "Push Press", prescribedReps: "50", prescribedWeightMale: 45, prescribedWeightFemale: 35 },
      { canonicalName: "Back Extension", prescribedReps: "50" },
      { canonicalName: "Wall Ball", prescribedReps: "50", prescribedWeightMale: 20, prescribedWeightFemale: 14 },
      { canonicalName: "Burpee", prescribedReps: "50" },
      { canonicalName: "Double-Under", prescribedReps: "50" },
    ],
  },
  {
    name: "The Chief",
    description: "5 cycles of 3-minute AMRAPs with 1 minute rest between cycles.",
    workoutType: "amrap",
    amrapDurationSeconds: 900,
    repScheme: "5 x 3-min AMRAPs",
    category: "gym_benchmark",
    movements: [
      { canonicalName: "Power Clean", prescribedReps: "3", prescribedWeightMale: 135, prescribedWeightFemale: 95 },
      { canonicalName: "Push-Up", prescribedReps: "6" },
      { canonicalName: "Air Squat", prescribedReps: "9" },
    ],
  },

  // Strength benchmarks are no longer hand-seeded here. Every 1RM-applicable
  // movement gets an auto-generated benchmark row keyed by movement_id (see
  // src/db/seeds/weightlifting_benchmarks.ts). The "1RM / 2RM / 3RM / 5RM"
  // tabs are derived at query time from the athlete's for_load history.

  // ============================================
  // CrossFit Open — recent selections
  // ============================================
  {
    name: "14.4",
    description: "2014 CrossFit Open 14.4. 14-minute AMRAP chipper climbing through row cals, T2B, wall balls, cleans, and muscle-ups.",
    workoutType: "amrap",
    amrapDurationSeconds: 840,
    category: "open",
    movements: [
      { canonicalName: "Row", prescribedReps: "60 calories" },
      { canonicalName: "Toes-to-Bar", prescribedReps: "50" },
      { canonicalName: "Wall Ball", prescribedReps: "40", prescribedWeightMale: 20, prescribedWeightFemale: 14, notes: "10/9 ft target" },
      { canonicalName: "Clean", prescribedReps: "30", prescribedWeightMale: 135, prescribedWeightFemale: 95 },
      { canonicalName: "Muscle-Up", prescribedReps: "20" },
    ],
  },
];

// ============================================
// Idempotent upsert helper — writes to the unified crossfit_workouts tree
// ============================================
//
// Identifies the canonical row by (title, is_system = true). The seed
// rebuilds parts/blocks/movements on every run; the fingerprint is
// recomputed so dedup queries continue to find the canonical template.

async function upsertBenchmark(
  db: ReturnType<typeof drizzle<typeof schema>>,
  benchmark: BenchmarkSeed,
  movementMap: Map<string, string>
): Promise<"created" | "updated" | "skipped"> {
  const parts = normalizeToParts(benchmark);
  const allMovementsFlat = parts.flatMap((p) => p.movements);
  const missing = allMovementsFlat.filter(
    (m) => !movementMap.has(m.canonicalName)
  );
  if (missing.length > 0) {
    console.warn(
      `  WARN: ${benchmark.name} — missing movements: ${missing.map((m) => m.canonicalName).join(", ")}. Skipping.`
    );
    return "skipped";
  }

  const firstPart = parts[0];

  // Build the TemplatePartInput[] shape from the seed parts so the
  // fingerprint and the insertion helper see the same coercion rules
  // every other write path uses.
  const templateParts: TemplatePartInput[] = parts.map((p) => ({
    label: p.label ?? null,
    workoutType: p.workoutType as TemplatePartInput["workoutType"],
    timeCapSeconds: p.timeCapSeconds ?? null,
    amrapDurationSeconds: p.amrapDurationSeconds ?? null,
    emomIntervalSeconds: p.emomIntervalSeconds ?? null,
    repScheme: p.repScheme ?? null,
    rounds: p.rounds ?? null,
    notes: p.notes ?? null,
    movements: p.movements.map((m) => ({
      movementId: movementMap.get(m.canonicalName)!,
      prescribedReps: m.prescribedReps,
      prescribedWeightMale: m.prescribedWeightMale,
      prescribedWeightFemale: m.prescribedWeightFemale,
      rxStandard: m.rxStandard,
      notes: m.notes ?? null,
    })),
  }));

  const fingerprint = computeWorkoutFingerprint(
    buildFingerprintInput({
      title: benchmark.name,
      scope: { kind: "system" },
      workoutType: firstPart.workoutType as TemplatePartInput["workoutType"],
      timeCapSeconds: firstPart.timeCapSeconds ?? null,
      amrapDurationSeconds: firstPart.amrapDurationSeconds ?? null,
      repScheme: firstPart.repScheme ?? null,
      isBenchmark: true,
      isSystem: true,
      vestRequirement: benchmark.requiresVest ? "required" : "none",
      vestWeightMaleLb: benchmark.vestWeightMaleLb ?? null,
      vestWeightFemaleLb: benchmark.vestWeightFemaleLb ?? null,
      isPartner: !!benchmark.isPartner,
      partnerCount: benchmark.partnerCount ?? null,
      parts: templateParts,
    })
  );

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: schema.crossfitWorkouts.id })
      .from(schema.crossfitWorkouts)
      .where(
        and(
          eq(schema.crossfitWorkouts.title, benchmark.name),
          eq(schema.crossfitWorkouts.isSystem, true),
          eq(schema.crossfitWorkouts.isBenchmark, true)
        )
      )
      .limit(1);

    let status: "created" | "updated";
    let templateId: string;

    if (existing.length > 0) {
      templateId = existing[0].id;
      status = "updated";

      await tx
        .update(schema.crossfitWorkouts)
        .set({
          description: benchmark.description || null,
          workoutType: firstPart.workoutType,
          category: benchmark.category,
          timeCapSeconds: firstPart.timeCapSeconds || null,
          amrapDurationSeconds: firstPart.amrapDurationSeconds || null,
          repScheme: firstPart.repScheme || null,
          contentFingerprint: fingerprint,
          vestRequirement: benchmark.requiresVest ? "required" : "none",
          vestWeightMaleLb:
            benchmark.vestWeightMaleLb != null
              ? String(benchmark.vestWeightMaleLb)
              : null,
          vestWeightFemaleLb:
            benchmark.vestWeightFemaleLb != null
              ? String(benchmark.vestWeightFemaleLb)
              : null,
          isPartner: !!benchmark.isPartner,
          partnerCount: benchmark.partnerCount ?? null,
          updatedAt: new Date(),
        })
        .where(eq(schema.crossfitWorkouts.id, templateId));

      // Cascade clears parts → movements via FK ON DELETE CASCADE.
      await tx
        .delete(schema.crossfitWorkoutParts)
        .where(eq(schema.crossfitWorkoutParts.crossfitWorkoutId, templateId));
    } else {
      const [tmpl] = await tx
        .insert(schema.crossfitWorkouts)
        .values({
          title: benchmark.name,
          description: benchmark.description || null,
          category: benchmark.category,
          workoutType: firstPart.workoutType,
          timeCapSeconds: firstPart.timeCapSeconds || null,
          amrapDurationSeconds: firstPart.amrapDurationSeconds || null,
          repScheme: firstPart.repScheme || null,
          contentFingerprint: fingerprint,
          vestRequirement: benchmark.requiresVest ? "required" : "none",
          vestWeightMaleLb:
            benchmark.vestWeightMaleLb != null
              ? String(benchmark.vestWeightMaleLb)
              : null,
          vestWeightFemaleLb:
            benchmark.vestWeightFemaleLb != null
              ? String(benchmark.vestWeightFemaleLb)
              : null,
          isPartner: !!benchmark.isPartner,
          partnerCount: benchmark.partnerCount ?? null,
          isBenchmark: true,
          isSystem: true,
        })
        .returning();
      templateId = tmpl.id;
      status = "created";
    }

    await insertTemplateParts(tx, templateId, templateParts);

    return status;
  });
}

// ============================================
// Seed function
// ============================================

export async function run() {
  const client = postgres(process.env.DATABASE_URL!);
  const db = drizzle(client, { schema });

  try {
    console.log("Seeding benchmark workouts...\n");

    const allMovements = await db.select().from(schema.movements);
    if (allMovements.length === 0) {
      console.error(
        "ERROR: No movements found in the database.\n" +
          "Run the movements seed first: npx tsx src/db/seed.ts"
      );
      process.exit(1);
    }
    console.log(`  Found ${allMovements.length} movements in the database.\n`);
    const movementMap = new Map(allMovements.map((m) => [m.canonicalName, m.id]));

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const benchmark of benchmarkSeeds) {
      const status = await upsertBenchmark(db, benchmark, movementMap);
      if (status === "created") {
        console.log(`  OK (new):     ${benchmark.name}`);
        created++;
      } else if (status === "updated") {
        console.log(`  OK (updated): ${benchmark.name}`);
        updated++;
      } else {
        skipped++;
      }
    }

    console.log(`\nDone! Created: ${created}, Updated: ${updated}, Skipped: ${skipped}`);
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
