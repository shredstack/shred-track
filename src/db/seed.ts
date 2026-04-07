import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "./schema";

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client, { schema });

// ============================================
// 1. Movement Library (~80 CrossFit movements)
// ============================================

type MovementSeed = {
  canonicalName: string;
  category: string;
  isWeighted: boolean;
  is1rmApplicable: boolean;
  commonRxWeightMale?: string;
  commonRxWeightFemale?: string;
};

const movementSeeds: MovementSeed[] = [
  // Barbell
  { canonicalName: "Back Squat", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { canonicalName: "Front Squat", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { canonicalName: "Overhead Squat", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { canonicalName: "Deadlift", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { canonicalName: "Sumo Deadlift High Pull", category: "barbell", isWeighted: true, is1rmApplicable: false, commonRxWeightMale: "75", commonRxWeightFemale: "55" },
  { canonicalName: "Clean", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { canonicalName: "Power Clean", category: "barbell", isWeighted: true, is1rmApplicable: true, commonRxWeightMale: "135", commonRxWeightFemale: "95" },
  { canonicalName: "Squat Clean", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { canonicalName: "Hang Clean", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { canonicalName: "Clean and Jerk", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { canonicalName: "Snatch", category: "barbell", isWeighted: true, is1rmApplicable: true, commonRxWeightMale: "135", commonRxWeightFemale: "95" },
  { canonicalName: "Power Snatch", category: "barbell", isWeighted: true, is1rmApplicable: true, commonRxWeightMale: "135", commonRxWeightFemale: "95" },
  { canonicalName: "Squat Snatch", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { canonicalName: "Hang Snatch", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { canonicalName: "Thruster", category: "barbell", isWeighted: true, is1rmApplicable: false, commonRxWeightMale: "95", commonRxWeightFemale: "65" },
  { canonicalName: "Push Press", category: "barbell", isWeighted: true, is1rmApplicable: true, commonRxWeightMale: "135", commonRxWeightFemale: "95" },
  { canonicalName: "Push Jerk", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { canonicalName: "Split Jerk", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { canonicalName: "Shoulder Press", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { canonicalName: "Bench Press", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { canonicalName: "Overhead Press", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { canonicalName: "Barbell Lunge", category: "barbell", isWeighted: true, is1rmApplicable: false },
  { canonicalName: "Barbell Row", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { canonicalName: "Cluster", category: "barbell", isWeighted: true, is1rmApplicable: false },
  { canonicalName: "Hang Power Clean", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { canonicalName: "Hang Power Snatch", category: "barbell", isWeighted: true, is1rmApplicable: true },

  // Dumbbell
  { canonicalName: "Dumbbell Snatch", category: "dumbbell", isWeighted: true, is1rmApplicable: false, commonRxWeightMale: "50", commonRxWeightFemale: "35" },
  { canonicalName: "Dumbbell Clean", category: "dumbbell", isWeighted: true, is1rmApplicable: false },
  { canonicalName: "Dumbbell Thruster", category: "dumbbell", isWeighted: true, is1rmApplicable: false, commonRxWeightMale: "50", commonRxWeightFemale: "35" },
  { canonicalName: "Devil Press", category: "dumbbell", isWeighted: true, is1rmApplicable: false, commonRxWeightMale: "50", commonRxWeightFemale: "35" },
  { canonicalName: "Man Maker", category: "dumbbell", isWeighted: true, is1rmApplicable: false, commonRxWeightMale: "50", commonRxWeightFemale: "35" },
  { canonicalName: "Turkish Get-Up", category: "dumbbell", isWeighted: true, is1rmApplicable: false },
  { canonicalName: "Dumbbell Lunge", category: "dumbbell", isWeighted: true, is1rmApplicable: false, commonRxWeightMale: "50", commonRxWeightFemale: "35" },
  { canonicalName: "Dumbbell Box Step-Up", category: "dumbbell", isWeighted: true, is1rmApplicable: false, commonRxWeightMale: "50", commonRxWeightFemale: "35" },
  { canonicalName: "Dumbbell Shoulder to Overhead", category: "dumbbell", isWeighted: true, is1rmApplicable: false },
  { canonicalName: "Dumbbell Hang Clean and Jerk", category: "dumbbell", isWeighted: true, is1rmApplicable: false },

  // Kettlebell
  { canonicalName: "Kettlebell Swing", category: "kettlebell", isWeighted: true, is1rmApplicable: false, commonRxWeightMale: "53", commonRxWeightFemale: "35" },
  { canonicalName: "Kettlebell Clean", category: "kettlebell", isWeighted: true, is1rmApplicable: false },
  { canonicalName: "Kettlebell Snatch", category: "kettlebell", isWeighted: true, is1rmApplicable: false },
  { canonicalName: "Goblet Squat", category: "kettlebell", isWeighted: true, is1rmApplicable: false },
  { canonicalName: "Kettlebell Turkish Get-Up", category: "kettlebell", isWeighted: true, is1rmApplicable: false },

  // Gymnastics
  { canonicalName: "Pull-Up", category: "gymnastics", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Chest-to-Bar Pull-Up", category: "gymnastics", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Muscle-Up", category: "gymnastics", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Bar Muscle-Up", category: "gymnastics", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Ring Muscle-Up", category: "gymnastics", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Handstand Push-Up", category: "gymnastics", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Strict Handstand Push-Up", category: "gymnastics", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Handstand Walk", category: "gymnastics", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Toes-to-Bar", category: "gymnastics", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Knees-to-Elbow", category: "gymnastics", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Rope Climb", category: "gymnastics", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Ring Dip", category: "gymnastics", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Pistol Squat", category: "gymnastics", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "L-Sit", category: "gymnastics", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Strict Pull-Up", category: "gymnastics", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Kipping Pull-Up", category: "gymnastics", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Ring Row", category: "gymnastics", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Legless Rope Climb", category: "gymnastics", isWeighted: false, is1rmApplicable: false },

  // Bodyweight
  { canonicalName: "Push-Up", category: "bodyweight", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Air Squat", category: "bodyweight", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Burpee", category: "bodyweight", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Burpee Box Jump Over", category: "bodyweight", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Box Jump", category: "bodyweight", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Box Step-Up", category: "bodyweight", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Lunge", category: "bodyweight", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Walking Lunge", category: "bodyweight", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Sit-Up", category: "bodyweight", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "GHD Sit-Up", category: "bodyweight", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Back Extension", category: "bodyweight", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Jumping Jack", category: "bodyweight", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Double-Under", category: "bodyweight", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Single-Under", category: "bodyweight", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Wall Ball", category: "bodyweight", isWeighted: true, is1rmApplicable: false, commonRxWeightMale: "20", commonRxWeightFemale: "14" },
  { canonicalName: "V-Up", category: "bodyweight", isWeighted: false, is1rmApplicable: false },

  // Monostructural
  { canonicalName: "Run", category: "monostructural", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Row", category: "monostructural", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Bike (Assault)", category: "monostructural", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "SkiErg", category: "monostructural", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Swim", category: "monostructural", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Bike (Echo)", category: "monostructural", isWeighted: false, is1rmApplicable: false },
  { canonicalName: "Sled Push", category: "monostructural", isWeighted: true, is1rmApplicable: false },
  { canonicalName: "Sled Pull", category: "monostructural", isWeighted: true, is1rmApplicable: false },
  { canonicalName: "Farmers Carry", category: "monostructural", isWeighted: true, is1rmApplicable: false },
  { canonicalName: "Sandbag Lunges", category: "monostructural", isWeighted: true, is1rmApplicable: false },
];

// ============================================
// 2. HYROX Divisions
// ============================================

type DivisionSeed = {
  divisionKey: string;
  category: string;
  genderLabel: string;
  displayOrder: number;
  stations: {
    station: string;
    distanceMeters?: string;
    reps?: number;
    weightKg?: string;
    weightNote?: string;
  }[];
};

function makeRunStations() {
  return [
    { station: "1km_run_1", distanceMeters: "1000" },
    { station: "1km_run_2", distanceMeters: "1000" },
    { station: "1km_run_3", distanceMeters: "1000" },
    { station: "1km_run_4", distanceMeters: "1000" },
    { station: "1km_run_5", distanceMeters: "1000" },
    { station: "1km_run_6", distanceMeters: "1000" },
    { station: "1km_run_7", distanceMeters: "1000" },
    { station: "1km_run_8", distanceMeters: "1000" },
  ];
}

const divisionSeeds: DivisionSeed[] = [
  // Men Open
  {
    divisionKey: "men_open",
    category: "single",
    genderLabel: "Men",
    displayOrder: 1,
    stations: [
      ...makeRunStations(),
      { station: "skierg", distanceMeters: "1000" },
      { station: "sled_push", distanceMeters: "50", weightKg: "152" },
      { station: "sled_pull", distanceMeters: "50", weightKg: "103" },
      { station: "burpee_broad_jump", distanceMeters: "80" },
      { station: "rowing", distanceMeters: "1000" },
      { station: "farmers_carry", distanceMeters: "200", weightKg: "24", weightNote: "2x24kg kettlebells" },
      { station: "sandbag_lunges", distanceMeters: "100", weightKg: "20" },
      { station: "wall_balls", reps: 100, weightKg: "9", weightNote: "9kg to 10ft" },
    ],
  },
  // Women Open
  {
    divisionKey: "women_open",
    category: "single",
    genderLabel: "Women",
    displayOrder: 2,
    stations: [
      ...makeRunStations(),
      { station: "skierg", distanceMeters: "1000" },
      { station: "sled_push", distanceMeters: "50", weightKg: "102" },
      { station: "sled_pull", distanceMeters: "50", weightKg: "78" },
      { station: "burpee_broad_jump", distanceMeters: "80" },
      { station: "rowing", distanceMeters: "1000" },
      { station: "farmers_carry", distanceMeters: "200", weightKg: "16", weightNote: "2x16kg kettlebells" },
      { station: "sandbag_lunges", distanceMeters: "100", weightKg: "10" },
      { station: "wall_balls", reps: 100, weightKg: "6", weightNote: "6kg to 9ft" },
    ],
  },
  // Men Pro
  {
    divisionKey: "men_pro",
    category: "single",
    genderLabel: "Men Pro",
    displayOrder: 3,
    stations: [
      ...makeRunStations(),
      { station: "skierg", distanceMeters: "1000" },
      { station: "sled_push", distanceMeters: "50", weightKg: "202" },
      { station: "sled_pull", distanceMeters: "50", weightKg: "153" },
      { station: "burpee_broad_jump", distanceMeters: "80" },
      { station: "rowing", distanceMeters: "1000" },
      { station: "farmers_carry", distanceMeters: "200", weightKg: "32", weightNote: "2x32kg kettlebells" },
      { station: "sandbag_lunges", distanceMeters: "100", weightKg: "30" },
      { station: "wall_balls", reps: 100, weightKg: "9", weightNote: "9kg to 11ft" },
    ],
  },
  // Women Pro
  {
    divisionKey: "women_pro",
    category: "single",
    genderLabel: "Women Pro",
    displayOrder: 4,
    stations: [
      ...makeRunStations(),
      { station: "skierg", distanceMeters: "1000" },
      { station: "sled_push", distanceMeters: "50", weightKg: "152" },
      { station: "sled_pull", distanceMeters: "50", weightKg: "103" },
      { station: "burpee_broad_jump", distanceMeters: "80" },
      { station: "rowing", distanceMeters: "1000" },
      { station: "farmers_carry", distanceMeters: "200", weightKg: "24", weightNote: "2x24kg kettlebells" },
      { station: "sandbag_lunges", distanceMeters: "100", weightKg: "20" },
      { station: "wall_balls", reps: 100, weightKg: "6", weightNote: "6kg to 10ft" },
    ],
  },
  // Men Doubles
  {
    divisionKey: "men_doubles",
    category: "double",
    genderLabel: "Men Doubles",
    displayOrder: 5,
    stations: [
      ...makeRunStations(),
      { station: "skierg", distanceMeters: "1000" },
      { station: "sled_push", distanceMeters: "50", weightKg: "152" },
      { station: "sled_pull", distanceMeters: "50", weightKg: "103" },
      { station: "burpee_broad_jump", distanceMeters: "80" },
      { station: "rowing", distanceMeters: "1000" },
      { station: "farmers_carry", distanceMeters: "200", weightKg: "24", weightNote: "2x24kg kettlebells" },
      { station: "sandbag_lunges", distanceMeters: "100", weightKg: "20" },
      { station: "wall_balls", reps: 100, weightKg: "9", weightNote: "9kg to 10ft" },
    ],
  },
  // Women Doubles
  {
    divisionKey: "women_doubles",
    category: "double",
    genderLabel: "Women Doubles",
    displayOrder: 6,
    stations: [
      ...makeRunStations(),
      { station: "skierg", distanceMeters: "1000" },
      { station: "sled_push", distanceMeters: "50", weightKg: "102" },
      { station: "sled_pull", distanceMeters: "50", weightKg: "78" },
      { station: "burpee_broad_jump", distanceMeters: "80" },
      { station: "rowing", distanceMeters: "1000" },
      { station: "farmers_carry", distanceMeters: "200", weightKg: "16", weightNote: "2x16kg kettlebells" },
      { station: "sandbag_lunges", distanceMeters: "100", weightKg: "10" },
      { station: "wall_balls", reps: 100, weightKg: "6", weightNote: "6kg to 9ft" },
    ],
  },
  // Mixed Doubles
  {
    divisionKey: "mixed_doubles",
    category: "double",
    genderLabel: "Mixed Doubles",
    displayOrder: 7,
    stations: [
      ...makeRunStations(),
      { station: "skierg", distanceMeters: "1000" },
      { station: "sled_push", distanceMeters: "50", weightKg: "127", weightNote: "Average of M/W" },
      { station: "sled_pull", distanceMeters: "50", weightKg: "91", weightNote: "Average of M/W" },
      { station: "burpee_broad_jump", distanceMeters: "80" },
      { station: "rowing", distanceMeters: "1000" },
      { station: "farmers_carry", distanceMeters: "200", weightKg: "20", weightNote: "M 24kg / W 16kg" },
      { station: "sandbag_lunges", distanceMeters: "100", weightKg: "15", weightNote: "M 20kg / W 10kg" },
      { station: "wall_balls", reps: 100, weightKg: "7.5", weightNote: "M 9kg/10ft, W 6kg/9ft" },
    ],
  },
  // Men Relay (4 person)
  {
    divisionKey: "men_relay",
    category: "relay",
    genderLabel: "Men Relay",
    displayOrder: 8,
    stations: [
      ...makeRunStations(),
      { station: "skierg", distanceMeters: "1000" },
      { station: "sled_push", distanceMeters: "50", weightKg: "152" },
      { station: "sled_pull", distanceMeters: "50", weightKg: "103" },
      { station: "burpee_broad_jump", distanceMeters: "80" },
      { station: "rowing", distanceMeters: "1000" },
      { station: "farmers_carry", distanceMeters: "200", weightKg: "24" },
      { station: "sandbag_lunges", distanceMeters: "100", weightKg: "20" },
      { station: "wall_balls", reps: 100, weightKg: "9" },
    ],
  },
  // Women Relay
  {
    divisionKey: "women_relay",
    category: "relay",
    genderLabel: "Women Relay",
    displayOrder: 9,
    stations: [
      ...makeRunStations(),
      { station: "skierg", distanceMeters: "1000" },
      { station: "sled_push", distanceMeters: "50", weightKg: "102" },
      { station: "sled_pull", distanceMeters: "50", weightKg: "78" },
      { station: "burpee_broad_jump", distanceMeters: "80" },
      { station: "rowing", distanceMeters: "1000" },
      { station: "farmers_carry", distanceMeters: "200", weightKg: "16" },
      { station: "sandbag_lunges", distanceMeters: "100", weightKg: "10" },
      { station: "wall_balls", reps: 100, weightKg: "6" },
    ],
  },
  // Mixed Relay
  {
    divisionKey: "mixed_relay",
    category: "relay",
    genderLabel: "Mixed Relay",
    displayOrder: 10,
    stations: [
      ...makeRunStations(),
      { station: "skierg", distanceMeters: "1000" },
      { station: "sled_push", distanceMeters: "50", weightKg: "127" },
      { station: "sled_pull", distanceMeters: "50", weightKg: "91" },
      { station: "burpee_broad_jump", distanceMeters: "80" },
      { station: "rowing", distanceMeters: "1000" },
      { station: "farmers_carry", distanceMeters: "200", weightKg: "20" },
      { station: "sandbag_lunges", distanceMeters: "100", weightKg: "15" },
      { station: "wall_balls", reps: 100, weightKg: "7.5" },
    ],
  },
];

// ============================================
// 3. HYROX Reference Times (per division)
// ============================================

// Reference times in seconds: [pro, average, slow]
// These are approximate benchmarks for the main single divisions
type RefTimes = { [station: string]: [number, number, number] };

const menOpenRefTimes: RefTimes = {
  "1km_run_1": [210, 300, 390],
  "skierg": [210, 300, 420],
  "1km_run_2": [215, 310, 400],
  "sled_push": [90, 180, 300],
  "1km_run_3": [220, 320, 420],
  "sled_pull": [90, 180, 300],
  "1km_run_4": [225, 330, 430],
  "burpee_broad_jump": [300, 480, 660],
  "1km_run_5": [230, 340, 450],
  "rowing": [210, 300, 420],
  "1km_run_6": [235, 350, 460],
  "farmers_carry": [120, 210, 330],
  "1km_run_7": [240, 360, 470],
  "sandbag_lunges": [240, 420, 600],
  "1km_run_8": [250, 370, 480],
  "wall_balls": [300, 480, 660],
};

const womenOpenRefTimes: RefTimes = {
  "1km_run_1": [240, 330, 420],
  "skierg": [240, 360, 480],
  "1km_run_2": [245, 340, 430],
  "sled_push": [120, 210, 360],
  "1km_run_3": [250, 350, 450],
  "sled_pull": [120, 210, 360],
  "1km_run_4": [255, 360, 460],
  "burpee_broad_jump": [360, 540, 720],
  "1km_run_5": [260, 370, 480],
  "rowing": [240, 360, 480],
  "1km_run_6": [265, 380, 490],
  "farmers_carry": [150, 240, 360],
  "1km_run_7": [270, 390, 510],
  "sandbag_lunges": [240, 420, 600],
  "1km_run_8": [280, 400, 520],
  "wall_balls": [360, 540, 720],
};

const menProRefTimes: RefTimes = {
  "1km_run_1": [180, 240, 330],
  "skierg": [180, 255, 360],
  "1km_run_2": [185, 250, 340],
  "sled_push": [75, 150, 240],
  "1km_run_3": [190, 260, 360],
  "sled_pull": [75, 150, 240],
  "1km_run_4": [195, 270, 370],
  "burpee_broad_jump": [240, 390, 540],
  "1km_run_5": [200, 280, 380],
  "rowing": [180, 255, 360],
  "1km_run_6": [205, 290, 390],
  "farmers_carry": [100, 180, 270],
  "1km_run_7": [210, 300, 400],
  "sandbag_lunges": [210, 360, 510],
  "1km_run_8": [215, 310, 420],
  "wall_balls": [240, 390, 540],
};

const womenProRefTimes: RefTimes = {
  "1km_run_1": [210, 285, 390],
  "skierg": [210, 300, 420],
  "1km_run_2": [215, 295, 400],
  "sled_push": [100, 180, 300],
  "1km_run_3": [220, 300, 410],
  "sled_pull": [100, 180, 300],
  "1km_run_4": [225, 310, 420],
  "burpee_broad_jump": [300, 450, 600],
  "1km_run_5": [230, 320, 430],
  "rowing": [210, 300, 420],
  "1km_run_6": [235, 330, 440],
  "farmers_carry": [120, 210, 300],
  "1km_run_7": [240, 340, 450],
  "sandbag_lunges": [210, 360, 510],
  "1km_run_8": [250, 350, 460],
  "wall_balls": [300, 450, 600],
};

const referenceTimesPerDivision: { [divisionKey: string]: RefTimes } = {
  men_open: menOpenRefTimes,
  women_open: womenOpenRefTimes,
  men_pro: menProRefTimes,
  women_pro: womenProRefTimes,
  // Doubles/relay use open times as baseline
  men_doubles: menOpenRefTimes,
  women_doubles: womenOpenRefTimes,
  mixed_doubles: menOpenRefTimes,
  men_relay: menOpenRefTimes,
  women_relay: womenOpenRefTimes,
  mixed_relay: menOpenRefTimes,
};

// ============================================
// Seed Runner
// ============================================

async function seed() {
  console.log("Seeding movements...");
  await db
    .insert(schema.movements)
    .values(movementSeeds)
    .onConflictDoNothing();
  console.log(`  -> ${movementSeeds.length} movements seeded.`);

  console.log("Seeding HYROX divisions...");
  for (const div of divisionSeeds) {
    const [inserted] = await db
      .insert(schema.hyroxDivisions)
      .values({
        divisionKey: div.divisionKey,
        category: div.category,
        genderLabel: div.genderLabel,
        displayOrder: div.displayOrder,
      })
      .onConflictDoNothing()
      .returning();

    // If the division already existed, fetch it
    let divisionId = inserted?.id;
    if (!divisionId) {
      const [existing] = await db
        .select()
        .from(schema.hyroxDivisions)
        .where(eq(schema.hyroxDivisions.divisionKey, div.divisionKey))
        .limit(1);
      divisionId = existing?.id;
    }

    if (!divisionId) {
      console.warn(`  Skipping stations for ${div.divisionKey} — could not find division ID.`);
      continue;
    }

    // Insert stations
    for (const st of div.stations) {
      await db
        .insert(schema.hyroxDivisionStations)
        .values({
          divisionId,
          station: st.station,
          distanceMeters: st.distanceMeters || null,
          reps: st.reps || null,
          weightKg: st.weightKg || null,
          weightNote: st.weightNote || null,
        })
        .onConflictDoNothing();
    }

    // Insert reference times
    const refTimes = referenceTimesPerDivision[div.divisionKey];
    if (refTimes) {
      for (const [station, [pro, avg, slow]] of Object.entries(refTimes)) {
        await db
          .insert(schema.hyroxStationReferenceTimes)
          .values({
            divisionId,
            station,
            proBenchmarkSeconds: pro,
            averageSeconds: avg,
            slowSeconds: slow,
            source: "seed_data",
          })
          .onConflictDoNothing();
      }
    }
  }

  console.log("  -> HYROX divisions, stations, and reference times seeded.");
  console.log("Seed complete!");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
