import type { RepSchemeParsed } from "@/lib/crossfit/rep-scheme-parser";

// ============================================
// Movement Metric Type
// ============================================
//
// How a movement is measured. Drives which gender-split inputs the workout
// builder UI exposes ("weight" → lb pair, "calories" → cal pair, etc.).

export const MOVEMENT_METRIC_TYPES = [
  "reps",
  "weight",
  "calories",
  "distance",
  "duration",
] as const;

export type MovementMetricType = (typeof MOVEMENT_METRIC_TYPES)[number];

// ============================================
// Workout Types
// ============================================

export const WORKOUT_TYPES = [
  "for_time",
  "amrap",
  "for_load",
  "for_reps",
  "for_calories",
  "emom",
  "tabata",
  "intervals",
  "max_effort",
  "other",
] as const;

export type WorkoutType = (typeof WORKOUT_TYPES)[number];

export const WORKOUT_TYPE_LABELS: Record<WorkoutType, string> = {
  for_time: "For Time",
  amrap: "AMRAP",
  for_load: "For Load",
  for_reps: "For Reps",
  for_calories: "For Calories",
  emom: "EMOM",
  tabata: "Tabata",
  intervals: "Intervals",
  max_effort: "Max Effort",
  other: "Other",
};

export const WORKOUT_TYPE_COLORS: Record<WorkoutType, string> = {
  for_time: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  amrap: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  for_load: "bg-red-500/20 text-red-400 border-red-500/30",
  for_reps: "bg-green-500/20 text-green-400 border-green-500/30",
  for_calories: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  emom: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  tabata: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  intervals: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  max_effort: "bg-rose-500/20 text-rose-400 border-rose-500/30",
  other: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
};

// ============================================
// Movement Categories
// ============================================

export const MOVEMENT_CATEGORIES = [
  "barbell",
  "dumbbell",
  "kettlebell",
  "gymnastics",
  "bodyweight",
  "monostructural",
  "accessory",
  "other",
] as const;

export type MovementCategory = (typeof MOVEMENT_CATEGORIES)[number];

export const MOVEMENT_CATEGORY_COLORS: Record<MovementCategory, string> = {
  barbell: "bg-red-500/20 text-red-400",
  dumbbell: "bg-orange-500/20 text-orange-400",
  kettlebell: "bg-yellow-500/20 text-yellow-400",
  gymnastics: "bg-blue-500/20 text-blue-400",
  bodyweight: "bg-green-500/20 text-green-400",
  monostructural: "bg-purple-500/20 text-purple-400",
  accessory: "bg-zinc-500/20 text-zinc-400",
  other: "bg-zinc-500/20 text-zinc-400",
};

// Display labels for movement categories — "Cardio" reads more naturally
// than "Monostructural" in user-facing UI.
export const MOVEMENT_CATEGORY_LABELS: Record<MovementCategory, string> = {
  barbell: "Barbell",
  dumbbell: "Dumbbell",
  kettlebell: "Kettlebell",
  gymnastics: "Gymnastics",
  bodyweight: "Bodyweight",
  monostructural: "Cardio",
  accessory: "Accessory",
  other: "Other",
};

export type CategoryFilter = "all" | MovementCategory;

// Used by <CategoryPills /> — the "All" entry is paired with the canonical
// category list so every consumer renders the same filter row.
export const CATEGORY_FILTER_OPTIONS: { key: CategoryFilter; label: string }[] = [
  { key: "all", label: "All" },
  ...MOVEMENT_CATEGORIES.map((cat) => ({
    key: cat,
    label: MOVEMENT_CATEGORY_LABELS[cat],
  })),
];

// ============================================
// Parsed Workout (from text parser)
// ============================================

export interface ParsedMovement {
  name: string;
  matchedCanonicalName?: string;
  reps?: string;
  weightMale?: number;
  weightFemale?: number;
  weightUnit?: "lb" | "kg";
  notes?: string;
  confidence: number; // 0-1
}

export interface ParsedWorkout {
  title?: string;
  workoutType: WorkoutType;
  workoutTypeConfidence: number;
  timeCapSeconds?: number;
  amrapDurationSeconds?: number;
  repScheme?: string;
  movements: ParsedMovement[];
  rawText: string;
  description?: string;
}

// ============================================
// Benchmark Workout Types
// ============================================

// ============================================
// Benchmark Categories (intrinsic to the benchmark itself)
// ============================================
//
// "Girls", "Heroes", etc. classify what kind of benchmark this is. NULL on
// user-created custom benchmarks that aren't tagged. Distinct from
// `BenchmarkCategory` below, which is the API filter for ownership
// (system / custom / community).

export const BENCHMARK_CATEGORIES = [
  "girls",
  "heroes",
  "open",
  "weightlifting",
  "gym_benchmark",
] as const;

export type BenchmarkCategoryName = (typeof BENCHMARK_CATEGORIES)[number];

export const BENCHMARK_CATEGORY_LABELS: Record<BenchmarkCategoryName, string> = {
  girls: "The Girls",
  heroes: "Hero WODs",
  open: "CF Open",
  weightlifting: "Weightlifting",
  gym_benchmark: "Gym Benchmark",
};

export const BENCHMARK_CATEGORY_SHORT_LABELS: Record<BenchmarkCategoryName, string> = {
  girls: "Girls",
  heroes: "Hero",
  open: "CF Open",
  weightlifting: "Weightlifting",
  gym_benchmark: "Gym",
};

export const BENCHMARK_CATEGORY_COLORS: Record<BenchmarkCategoryName, string> = {
  girls: "bg-pink-500/15 text-pink-300 border-pink-500/30",
  heroes: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  open: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  weightlifting: "bg-red-500/15 text-red-300 border-red-500/30",
  gym_benchmark: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
};

export interface BenchmarkUserStats {
  attempts: number;
  bestScore: BenchmarkBestScore | null;
  lastAttemptDate: string | null;
}

export interface BenchmarkBestScore {
  display: string;
  division: string;
  workoutDate: string;
  hitTimeCap: boolean;
  timeSeconds: number | null;
  totalReps: number | null;
  weightLbs: number | null;
  rounds: number | null;
  remainderReps: number | null;
}

export interface BenchmarkAttempt {
  scoreId: string;
  workoutId: string;
  workoutDate: string;
  division: string;
  timeSeconds: number | null;
  rounds: number | null;
  remainderReps: number | null;
  weightLbs: number | null;
  totalReps: number | null;
  scoreText: string | null;
  hitTimeCap: boolean;
  notes: string | null;
  createdAt: string;
  isPR: boolean;
}

export interface BenchmarkHistory {
  benchmarkId: string;
  benchmarkName: string;
  workoutType: WorkoutType;
  attempts: BenchmarkAttempt[];
}

export interface BenchmarkWorkout {
  id: string;
  name: string;
  description: string | null;
  workoutType: WorkoutType;
  category: BenchmarkCategoryName | null;
  timeCapSeconds: number | null;
  amrapDurationSeconds: number | null;
  repScheme: string | null;
  isSystem: boolean;
  createdBy: string | null;
  communityId: string | null;
  requiresVest?: boolean;
  vestWeightMaleLb?: number | null;
  vestWeightFemaleLb?: number | null;
  movements: BenchmarkMovement[];
  userStats?: BenchmarkUserStats;
}

export interface BenchmarkMovement {
  id: string;
  movementId: string;
  movementName: string;
  orderIndex: number;
  prescribedReps: string | null;
  prescribedWeightMale: number | null;
  prescribedWeightFemale: number | null;
  isMaxReps?: boolean;
  rxStandard: string | null;
}

export type BenchmarkCategory = "system" | "custom" | "community";

// ============================================
// Workout Display Types
// ============================================

export interface WorkoutMovementDisplay {
  id: string;
  movementId: string;
  movementName: string;
  category: MovementCategory;
  orderIndex: number;
  prescribedReps?: string;
  prescribedWeightMale?: string;
  prescribedWeightFemale?: string;
  prescribedCaloriesMale?: number;
  prescribedCaloriesFemale?: number;
  prescribedDistanceMale?: number;
  prescribedDistanceFemale?: number;
  prescribedDurationSecondsMale?: number;
  prescribedDurationSecondsFemale?: number;
  prescribedHeightInches?: number;
  prescribedWeightMaleBwMultiplier?: number;
  prescribedWeightFemaleBwMultiplier?: number;
  tempo?: string;
  isMaxReps?: boolean;
  equipmentCount?: number;
  rxStandard?: string;
  notes?: string;
  isWeighted: boolean;
  metricType: MovementMetricType;
  repSchemeParsed?: RepSchemeParsed | null;
}

export type WorkoutPartStructure = "tabata";

export interface WorkoutPartDisplay {
  id: string;
  orderIndex: number;
  label?: string | null;
  workoutType: WorkoutType;
  timeCapSeconds?: number;
  amrapDurationSeconds?: number;
  emomIntervalSeconds?: number;
  intervalWorkSeconds?: number;
  intervalRestSeconds?: number;
  repScheme?: string;
  rounds?: number;
  structure?: WorkoutPartStructure;
  notes?: string;
  movements: WorkoutMovementDisplay[];
  score?: ScoreDisplay | null;
}

export interface WorkoutDisplay {
  id: string;
  title?: string;
  description?: string;
  workoutDate: string;
  parts: WorkoutPartDisplay[];
  createdBy: string;
  createdByName?: string;
  benchmarkWorkoutId?: string | null;
  requiresVest?: boolean;
  vestWeightMaleLb?: number;
  vestWeightFemaleLb?: number;
}

export interface ScoreDisplay {
  id: string;
  workoutPartId?: string;
  division: "rx" | "scaled" | "rx_plus";
  timeSeconds?: number;
  rounds?: number;
  remainderReps?: number;
  weightLbs?: string;
  totalReps?: number;
  scoreText?: string;
  hitTimeCap: boolean;
  notes?: string;
  rpe?: number;
  // Vest the athlete actually wore. Only meaningful when the workout
  // requires a vest. Surfaces as a "Wore vest" / "No vest" badge in the
  // score row.
  woreVest?: boolean | null;
  vestWeightLb?: number;
  userName?: string;
  scalingDetails?: MovementScalingDisplay[];
  movementDetails?: ScoreMovementDetailDisplay[];
}

// One per-set entry on a for_load movement. `weight` is required (lb);
// `reps` is the per-set rep count (defaults from the prescribed scheme but
// can be overridden when reality deviates); `rpe` is per-set effort 1-10.
export interface SetEntry {
  weight: number;
  reps?: number;
  rpe?: number;
}

export interface ScoreMovementDetailDisplay {
  workoutMovementId: string;
  movementName?: string;
  wasRx: boolean;
  actualWeight?: number;
  actualReps?: string;
  modification?: string;
  substitutionMovementId?: string;
  setEntries?: SetEntry[];
  actualDurationSeconds?: number;
  actualHeightInches?: number;
  // Per-round rep counts when this is a max-reps movement.
  actualRepsPerRound?: number[];
  notes?: string;
}

export interface MovementScalingDisplay {
  workoutMovementId: string;
  movementName: string;
  wasRx: boolean;
  actualWeight?: string;
  actualReps?: string;
  modification?: string;
  substitutionName?: string;
}

// ============================================
// Score Entry Form Types
// ============================================

export interface ScoreInput {
  workoutId: string;
  workoutPartId?: string;
  division: "rx" | "scaled" | "rx_plus";
  timeSeconds?: number;
  rounds?: number;
  remainderReps?: number;
  weightLbs?: number;
  totalReps?: number;
  scoreText?: string;
  hitTimeCap: boolean;
  notes?: string;
  rpe?: number;
  woreVest?: boolean;
  vestWeightLb?: number;
  movementScalings: MovementScaling[];
}

export interface MovementScaling {
  workoutMovementId: string;
  wasRx: boolean;
  actualWeight?: number;
  actualReps?: string;
  modification?: string;
  substitutionMovementId?: string;
  setEntries?: SetEntry[];
  actualDurationSeconds?: number;
  actualHeightInches?: number;
  actualRepsPerRound?: number[];
  notes?: string;
}

// ============================================
// Workout Builder Form Types
// ============================================

export interface WorkoutBuilderMovement {
  tempId: string;
  // Real DB id when editing an existing workout. Undefined for newly added
  // movements; used by the diff-based update endpoint to preserve scores.
  id?: string;
  movementId?: string;
  movementName: string;
  category?: MovementCategory;
  isWeighted: boolean;
  is1rmApplicable?: boolean;
  metricType: MovementMetricType;
  prescribedReps: string;
  // When true and `prescribedReps` is a closed arithmetic sequence (e.g.
  // "3-6-9-12-15"), the server promotes the parsed shape from `sequence`
  // to an open `ladder`. Surfaces in the builder as a "Continue as
  // ladder?" checkbox under the parser-feedback chip.
  promoteSequenceToLadder?: boolean;
  prescribedWeightMale: string;
  prescribedWeightFemale: string;
  prescribedCaloriesMale: string;
  prescribedCaloriesFemale: string;
  prescribedDistanceMale: string;
  prescribedDistanceFemale: string;
  // Free-text duration (parsed at save). Accepts "30", ":30", "1:30", etc.
  prescribedDurationSecondsMale: string;
  prescribedDurationSecondsFemale: string;
  prescribedHeightInches: string;
  // Builder-only flag: when true, the BW-multiplier inputs are surfaced
  // and the absolute lb fields are ignored on save. Lets the user pick
  // one notation explicitly without forcing them to clear the other.
  useBwMultiplier?: boolean;
  prescribedWeightMaleBwMultiplier: string;
  prescribedWeightFemaleBwMultiplier: string;
  tempo: string;
  // When true, the prescribedReps field is suppressed and the score-entry
  // surfaces per-round rep inputs that auto-sum into the part's total.
  isMaxReps?: boolean;
  equipmentCount?: number;
  rxStandard: string;
  notes: string;
}

export interface WorkoutBuilderPart {
  tempId: string;
  // Real DB id when editing an existing workout. Undefined for newly added
  // parts; used by the diff-based update endpoint to preserve scores on
  // existing parts.
  id?: string;
  label: string;
  workoutType: WorkoutType;
  timeCapMinutes: string;
  amrapDurationMinutes: string;
  emomIntervalSeconds: string;
  // "Intervals" workout type: per-round work + rest cadence (free-text
  // mm:ss-style strings; parsed on save).
  intervalWorkSeconds: string;
  intervalRestSeconds: string;
  // Workout-level rep scheme. Retained on the type for legacy / parsed
  // workouts; the Smart Builder no longer surfaces it directly — for_load
  // expresses its scheme per-movement via `prescribedReps`, and round-based
  // workouts use `rounds` below.
  repScheme: string;
  rounds: string;
  structure?: WorkoutPartStructure;
  movements: WorkoutBuilderMovement[];
}

export interface WorkoutBuilderForm {
  title: string;
  description: string;
  workoutDate: string;
  parts: WorkoutBuilderPart[];
  benchmarkWorkoutId?: string | null;
  // Workout-level vest fields (Murph requires_vest = true / 20 / 14).
  requiresVest?: boolean;
  vestWeightMaleLb?: string;
  vestWeightFemaleLb?: string;
}

// ============================================
// Leaderboard Types
// ============================================

export interface LeaderboardEntry {
  scoreId: string;
  userId: string;
  userName: string;
  division: "rx" | "scaled" | "rx_plus";
  displayScore: string;
  sortValue: number;
  timeSeconds?: number;
  rounds?: number;
  remainderReps?: number;
  weightLbs?: string;
  totalReps?: number;
  scoreText?: string;
  hitTimeCap: boolean;
  rpe?: number;
  scalingDetails?: MovementScalingDisplay[];
}

// ============================================
// Movement Library
// ============================================

export interface MovementOption {
  id: string;
  canonicalName: string;
  category: MovementCategory;
  isWeighted: boolean;
  is1rmApplicable: boolean;
  metricType: MovementMetricType;
  commonRxWeightMale?: string;
  commonRxWeightFemale?: string;
  videoUrl?: string | null;
}

// ============================================
// Notes Extraction (Phase 4 — VIP-gated)
// ============================================

// One physical/mental complaint mentioned in a score note. `topic` is a short
// canonical phrase (e.g. "shoulder", "low back") so we can group across notes.
export interface NotesComplaint {
  topic: string;
  phrase: string; // verbatim snippet from the note
  confidence: number; // 0..1
}

export interface NotesScalingReason {
  movement: string | null; // best-guess movement name; null if unspecified
  reason: string; // short canonical reason ("grip", "shoulder pain", "skill")
  phrase: string;
}

export type NotesMilestoneType = "first" | "pr" | "win";

export interface NotesMilestone {
  type: NotesMilestoneType;
  phrase: string;
}

export interface NotesExtraction {
  complaints: NotesComplaint[];
  scalingRationale: NotesScalingReason[];
  milestones: NotesMilestone[];
}
