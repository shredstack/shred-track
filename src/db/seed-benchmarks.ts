import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and } from "drizzle-orm";
import * as schema from "./schema";

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client, { schema });

// ============================================
// Benchmark definitions keyed by movement canonical names
// ============================================

type BenchmarkSeed = {
  name: string;
  description?: string;
  workoutType: string;
  timeCapSeconds?: number;
  amrapDurationSeconds?: number;
  repScheme?: string;
  category: "girls" | "heroes" | "common";
  movements: {
    canonicalName: string;
    prescribedReps?: string;
    prescribedWeightMale?: number;
    prescribedWeightFemale?: number;
    rxStandard?: string;
    notes?: string;
  }[];
};

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
    description: "In honor of Navy Lt. Michael Murphy. Wear a 20/14 lb vest if possible.",
    workoutType: "for_time",
    category: "heroes",
    movements: [
      { canonicalName: "Run", prescribedReps: "1 mile" },
      { canonicalName: "Pull-Up", prescribedReps: "100" },
      { canonicalName: "Push-Up", prescribedReps: "200" },
      { canonicalName: "Air Squat", prescribedReps: "300" },
      { canonicalName: "Run", prescribedReps: "1 mile", notes: "Finish with a 1-mile run" },
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

  // ============================================
  // Common Gym Benchmarks
  // ============================================
  {
    name: "Fight Gone Bad",
    description: "3 rounds, 1 minute at each station, 1 minute rest between rounds. Score is total reps.",
    workoutType: "for_reps",
    repScheme: "3 rounds",
    category: "common",
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
    category: "common",
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
    category: "common",
    movements: [
      { canonicalName: "Power Clean", prescribedReps: "3", prescribedWeightMale: 135, prescribedWeightFemale: 95 },
      { canonicalName: "Push-Up", prescribedReps: "6" },
      { canonicalName: "Air Squat", prescribedReps: "9" },
    ],
  },
];

// ============================================
// Seed function
// ============================================

async function seedBenchmarks() {
  console.log("Seeding benchmark workouts...\n");

  // Build a lookup of movement canonical names -> IDs
  const allMovements = await db.select().from(schema.movements);
  if (allMovements.length === 0) {
    console.error(
      "ERROR: No movements found in the database.\n" +
      "Run the movements seed first: npx tsx src/db/seed.ts"
    );
    await client.end();
    process.exit(1);
  }
  console.log(`  Found ${allMovements.length} movements in the database.\n`);
  const movementMap = new Map(allMovements.map((m) => [m.canonicalName, m.id]));

  let created = 0;
  let skipped = 0;

  for (const benchmark of benchmarkSeeds) {
    // Check if this system benchmark already exists
    const existing = await db
      .select()
      .from(schema.benchmarkWorkouts)
      .where(
        and(
          eq(schema.benchmarkWorkouts.name, benchmark.name),
          eq(schema.benchmarkWorkouts.isSystem, true)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      console.log(`  SKIP: ${benchmark.name} (already exists)`);
      skipped++;
      continue;
    }

    // Validate all movements exist
    const missingMovements = benchmark.movements.filter(
      (m) => !movementMap.has(m.canonicalName)
    );
    if (missingMovements.length > 0) {
      console.warn(
        `  WARN: ${benchmark.name} — missing movements: ${missingMovements.map((m) => m.canonicalName).join(", ")}. Skipping.`
      );
      skipped++;
      continue;
    }

    // Insert benchmark workout
    const [bw] = await db
      .insert(schema.benchmarkWorkouts)
      .values({
        name: benchmark.name,
        description: benchmark.description || null,
        workoutType: benchmark.workoutType,
        timeCapSeconds: benchmark.timeCapSeconds || null,
        amrapDurationSeconds: benchmark.amrapDurationSeconds || null,
        repScheme: benchmark.repScheme || null,
        createdBy: null,
        communityId: null,
        isSystem: true,
      })
      .returning();

    // Insert movements
    await db.insert(schema.benchmarkWorkoutMovements).values(
      benchmark.movements.map((m, i) => ({
        benchmarkWorkoutId: bw.id,
        movementId: movementMap.get(m.canonicalName)!,
        orderIndex: i,
        prescribedReps: m.prescribedReps || null,
        prescribedWeightMale: m.prescribedWeightMale?.toString() || null,
        prescribedWeightFemale: m.prescribedWeightFemale?.toString() || null,
        rxStandard: m.rxStandard || null,
        notes: m.notes || null,
      }))
    );

    console.log(`  OK: ${benchmark.name} (${benchmark.movements.length} movements)`);
    created++;
  }

  console.log(`\nDone! Created: ${created}, Skipped: ${skipped}`);
  await client.end();
}

seedBenchmarks().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
