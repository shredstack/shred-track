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
// Weight Source (athlete-picked vs prescribed)
// ============================================

export const WEIGHT_SOURCES = ["prescribed", "athlete"] as const;
export type WeightSource = (typeof WEIGHT_SOURCES)[number];

// ============================================
// Part Score Type Override
// ============================================

export const PART_SCORE_TYPES = ["reps", "load"] as const;
export type PartScoreType = (typeof PART_SCORE_TYPES)[number];

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
  "timed_rounds",
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
  timed_rounds: "Timed Rounds",
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
  timed_rounds: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  tabata: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  intervals: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  max_effort: "bg-rose-500/20 text-rose-400 border-rose-500/30",
  other: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
};

// ============================================
// Round Score Aggregation (timed_rounds)
// ============================================

export const ROUND_SCORE_AGGREGATIONS = [
  "slowest",
  "fastest",
  "sum",
  "average",
] as const;

export type RoundScoreAggregation = (typeof ROUND_SCORE_AGGREGATIONS)[number];

export const ROUND_SCORE_AGGREGATION_LABELS: Record<
  RoundScoreAggregation,
  string
> = {
  slowest: "Slowest Round",
  fastest: "Fastest Round",
  sum: "Sum",
  average: "Avg Round",
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
  // When the input line describes a calorie- or distance-bound movement
  // (e.g. "Row 21/15 cal", "400m Run"), the parser populates these
  // dedicated fields rather than stuffing the value into `reps`. The save
  // path then routes them to the matching prescribed_* columns.
  caloriesMale?: number;
  caloriesFemale?: number;
  distanceMaleMeters?: number;
  distanceFemaleMeters?: number;
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
  // Timed Rounds: rounds count (from "for N rounds"), per-round window
  // (from "every M:SS"), and aggregation (defaulted to 'slowest' when the
  // text matched the header but not a scoring line). Optional so other
  // workout types' parsed payloads are unaffected.
  rounds?: number;
  roundWindowSeconds?: number;
  roundScoreAggregation?: RoundScoreAggregation;
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

// Targeted rep counts surfaced as tabs on a weightlifting benchmark.
// Stored neither on scores nor benchmarks — derived at query time from the
// for_load part's rep_scheme via inferRepMaxTarget().
export type RepMaxTarget = 1 | 2 | 3 | 5;
export const REP_MAX_TARGETS: readonly RepMaxTarget[] = [1, 2, 3, 5];

export interface RepMaxStat {
  weightLbs: number;
  workoutDate: string;
  scoreId: string;
}

export interface BenchmarkUserStats {
  attempts: number;
  bestScore: BenchmarkBestScore | null;
  lastAttemptDate: string | null;
  // Only populated for weightlifting benchmarks (where the response also
  // carries weightliftingMovementId). One entry per rep target the athlete
  // has logged — missing keys mean "no attempts at that target".
  repMaxStats?: Partial<Record<RepMaxTarget, RepMaxStat>>;
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
  sessionId: string | null;
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

// Weightlifting benchmark history. Same attempts list, but split by the
// rep-max target inferred from each attempt's part rep_scheme. PRs are
// per-target (one heaviest weight per tab) rather than a single PR across
// the whole benchmark.
export interface WeightliftingRepMaxVariant {
  repTarget: RepMaxTarget;
  attempts: BenchmarkAttempt[];
  pr: { weightLbs: number; workoutDate: string; scoreId: string } | null;
}

export interface WeightliftingBenchmarkHistory {
  benchmarkId: string;
  benchmarkName: string;
  workoutType: WorkoutType;
  // Discriminator: presence of repMaxHistory tells the client this is a
  // weightlifting benchmark and the tabs UI should render.
  repMaxHistory: {
    movementId: string;
    movementName: string;
    variants: WeightliftingRepMaxVariant[];
  };
}

// Union returned by /api/benchmarks/[id]/history. Discriminate via
// `repMaxHistory in response`.
export type BenchmarkHistoryResponse =
  | BenchmarkHistory
  | WeightliftingBenchmarkHistory;

export interface BenchmarkWorkout {
  id: string;
  name: string;
  description: string | null;
  // Legacy single-part fields. Retained for one release as a read-only
  // fallback so callers that haven't been updated to consume `parts`
  // (preview cards, leaderboard headers, etc.) keep rendering. New writes
  // should always populate `parts`.
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
  isPartner?: boolean;
  partnerCount?: number | null;
  // Deprecated flat movement list. Mirrors the movements of the first
  // part for backward compatibility; new code should iterate `parts`.
  movements: BenchmarkMovement[];
  // Multi-part shape. Always populated by the API: legacy single-part
  // benchmarks are wrapped in a synthetic one-part array on read so this
  // field is the single source of truth for renderers going forward.
  parts: BenchmarkWorkoutPart[];
  userStats?: BenchmarkUserStats;
  // When non-null, this is an auto-generated weightlifting benchmark
  // anchored to the named movement. Drives the rep-max tabs UI on the
  // detail dialog and the per-target teaser on the list row.
  weightliftingMovementId?: string | null;
}

export interface BenchmarkWorkoutPart {
  id: string;
  orderIndex: number;
  label: string | null;
  workoutType: WorkoutType;
  timeCapSeconds: number | null;
  amrapDurationSeconds: number | null;
  emomIntervalSeconds: number | null;
  repScheme: string | null;
  rounds: number | null;
  structure: WorkoutPartStructure | null;
  intervalWorkSeconds: number | null;
  intervalRestSeconds: number | null;
  intervalRounds: IntervalRoundSpec[] | null;
  sideCadenceIntervalSeconds: number | null;
  sideCadenceOpenEnded: boolean;
  scoreType?: PartScoreType | null;
  // Timed Rounds: aggregation strategy + optional per-round window.
  roundScoreAggregation?: RoundScoreAggregation | null;
  roundWindowSeconds?: number | null;
  notes: string | null;
  movements: BenchmarkMovement[];
  // Optional named groupings under this part. Empty array = no grouping
  // (movements render flat). Movements join blocks via BenchmarkMovement.blockId.
  blocks: BenchmarkWorkoutBlock[];
}

export interface BenchmarkWorkoutBlock {
  id: string;
  orderIndex: number;
  title: string;
}

export interface BenchmarkMovement {
  id: string;
  movementId: string;
  movementName: string;
  orderIndex: number;
  // Optional FK to a benchmark_workout_block. Null = ungrouped within the
  // part (renders flat).
  blockId: string | null;
  // Joined from the movements library so the admin/edit form can render
  // the right inputs (cals vs. weight vs. distance) without re-deriving.
  category?: MovementCategory;
  isWeighted?: boolean;
  metricType?: MovementMetricType;
  prescribedReps: string | null;
  prescribedWeightMale: number | null;
  prescribedWeightFemale: number | null;
  prescribedCaloriesMale?: string | null;
  prescribedCaloriesFemale?: string | null;
  prescribedDistanceMale?: string | null;
  prescribedDistanceFemale?: string | null;
  prescribedDurationSecondsMale?: number | null;
  prescribedDurationSecondsFemale?: number | null;
  prescribedHeightInches?: number | null;
  prescribedHeightInchesMale?: number | null;
  prescribedHeightInchesFemale?: number | null;
  prescribedWeightMaleBwMultiplier?: number | null;
  prescribedWeightFemaleBwMultiplier?: number | null;
  // weight_pct Rx — % of the max load logged on an earlier for_load part.
  prescribedWeightPct?: number | null;
  prescribedWeightPctSourcePartId?: string | null;
  tempo?: string | null;
  isMaxReps?: boolean;
  // When true the athlete logs one duration per round at score entry
  // (e.g. "Run 400m × 3 as fast as possible"). Sums into the part's total
  // time. Mutually exclusive with isMaxReps.
  captureDurationPerRound?: boolean;
  isSideCadence?: boolean;
  equipmentCount?: number | null;
  rxStandard: string | null;
  notes?: string | null;
  weightSource?: WeightSource;
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
  // Optional FK to a workout_block. Null = ungrouped within the part.
  workoutBlockId: string | null;
  prescribedReps?: string;
  prescribedWeightMale?: string;
  prescribedWeightFemale?: string;
  prescribedCaloriesMale?: string;
  prescribedCaloriesFemale?: string;
  prescribedDistanceMale?: string;
  prescribedDistanceFemale?: string;
  prescribedDurationSecondsMale?: number;
  prescribedDurationSecondsFemale?: number;
  prescribedHeightInches?: number;
  prescribedHeightInchesMale?: number;
  prescribedHeightInchesFemale?: number;
  prescribedWeightMaleBwMultiplier?: number;
  prescribedWeightFemaleBwMultiplier?: number;
  // weight_pct Rx — % of the max load logged on an earlier for_load part.
  prescribedWeightPct?: number;
  prescribedWeightPctSourcePartId?: string;
  tempo?: string;
  isMaxReps?: boolean;
  // When true the athlete logs one duration per round at score entry
  // (e.g. "Run 400m × 3 as fast as possible"). Sums into the part's total
  // time. Mutually exclusive with isMaxReps.
  captureDurationPerRound?: boolean;
  // When true, this movement runs on the part's side-cadence rather than
  // contributing to the main task.
  isSideCadence?: boolean;
  equipmentCount?: number;
  rxStandard?: string;
  notes?: string;
  isWeighted: boolean;
  metricType: MovementMetricType;
  repSchemeParsed?: RepSchemeParsed | null;
  weightSource: WeightSource;
}

// Structural pattern modifier for a part. `tabata` is a For Reps cadence
// (8 × :20/:10). `complex` marks a For Load part whose movements are
// performed back-to-back as one unbroken set (a barbell complex) — no rest
// between movements, scored by load.
export type WorkoutPartStructure = "tabata" | "complex";

export interface IntervalRoundSpec {
  workSeconds: number;
  restSeconds: number;
}

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
  // Per-round (work, rest) array. When set, supersedes the single-pair
  // legacy columns. Length should equal `rounds`.
  intervalRounds?: IntervalRoundSpec[];
  repScheme?: string;
  rounds?: number;
  structure?: WorkoutPartStructure;
  // Side-cadence config (Kalsu-style "150 DB cleans for time, EMOM 5
  // burpees"). When set, the movements flagged as `isSideCadence`
  // are performed on this cadence while the others form the main task.
  sideCadenceIntervalSeconds?: number;
  sideCadenceOpenEnded?: boolean;
  scoreType?: PartScoreType | null;
  // Timed Rounds — aggregation strategy + optional per-round window.
  roundScoreAggregation?: RoundScoreAggregation;
  roundWindowSeconds?: number;
  notes?: string;
  movements: WorkoutMovementDisplay[];
  // Optional named groupings under this part. Empty = no grouping.
  // Movements join blocks via WorkoutMovementDisplay.workoutBlockId.
  blocks: WorkoutBlockDisplay[];
  score?: ScoreDisplay | null;
}

export interface WorkoutBlockDisplay {
  id: string;
  orderIndex: number;
  title: string;
}

export type WorkoutSectionKindDisplay =
  | "warm_up"
  | "pre_skill"
  | "wod"
  | "post_skill"
  | "stretching"
  | "at_home"
  | "monthly_challenge"
  | "custom";

export type WorkoutSectionScoreTypeDisplay =
  | "time"
  | "rounds"
  | "reps"
  | "weight"
  | "no_score";

export interface WorkoutSectionDisplay {
  id: string;
  kind: WorkoutSectionKindDisplay;
  position: number;
  title: string | null;
  /** Freeform prescription text — used for sections without Smart Builder
   *  parts (warm-ups, stretching, etc.). Rendered above the parts list. */
  body?: string | null;
  /** Coach-authored notes captured via the Smart Builder's "Notes" field
   *  when the section was composed in the programming admin. Rendered
   *  beneath the parts list. */
  notes?: string | null;
  isScored: boolean;
  scoreType: WorkoutSectionScoreTypeDisplay | null;
  /** Ordered list of workout_part IDs that belong to this section.
   *  The CrossFit tab renders these parts inline under the section card. */
  partIds: string[];
  /** When the section came from a programming track (Custom Tracks v2),
   *  these surface the link back so the athlete UI can render a
   *  TrackDayScoreInput for free-form (no-workout) track days. */
  sourceTrackId?: string | null;
  trackDayId?: string | null;
  /** Inlined from the parent track's scoring_config for free-form track
   *  days, so the per-day input knows the unit / aggregation / target. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trackScoringConfig?: any | null;
  /** Prescribed numeric amount for the day (e.g. 40 sit-ups). Used to
   *  auto-fill the rollup when the athlete taps "Mark done" without
   *  entering a number. Null on rest days / unconfigured tracks. */
  trackPrescribedValue?: number | null;
  /** Set when the section was composed from a named benchmark (Laura,
   *  Murph, etc.). Used by the athlete view to attach the workout-level
   *  description / partner / vest chips to the right section rather
   *  than the day header. */
  benchmarkWorkoutId?: string | null;
}

export interface WorkoutDisplay {
  id: string;
  title?: string;
  description?: string;
  workoutDate: string;
  parts: WorkoutPartDisplay[];
  createdBy: string;
  createdByName?: string;
  /** Null = personal workout. Non-null = gym workout, scoped to that gym. */
  communityId?: string | null;
  /** Gym name, only set when communityId is set. Replaces "Programmed by"
   *  attribution on member-facing cards (spec §1.3). */
  communityName?: string | null;
  /** Gym logo URL, only set when communityId is set. */
  communityLogoUrl?: string | null;
  /** Typed sections (spec §1.6). When present, the CrossFit tab renders one
   *  card per section instead of a flat body. When empty, falls back to
   *  the legacy single-body layout. */
  sections?: WorkoutSectionDisplay[];
  benchmarkWorkoutId?: string | null;
  requiresVest?: boolean;
  vestWeightMaleLb?: number;
  vestWeightFemaleLb?: number;
  isPartner?: boolean;
  partnerCount?: number | null;
  /** Template-level calorie estimate (75 kg reference). May be null when the
   *  Inngest compute job hasn't run yet on a freshly-created workout. */
  estimatedKcalLow?: number | null;
  estimatedKcalHigh?: number | null;
  estimatedKcalConfidence?: "high" | "medium" | "low" | null;
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
  // Per-round durations (seconds) for a timed_rounds part. Length should
  // equal the part's `rounds`. The aggregated value (slowest / fastest /
  // sum / average) is stored in `timeSeconds` so leaderboard sort works
  // without any special-case math.
  roundDurationsSeconds?: number[];
  /** Personalized calorie estimate (athlete bodyweight, EPOC applied per
   *  user preference). Surfaced in post-score summary and the score row. */
  estimatedKcal?: number | null;
  estimatedKcalActive?: number | null;
  estimatedKcalWithEpoc?: number | null;
  estimatedKcalActiveWithEpoc?: number | null;
  estimatedKcalConfidence?: "high" | "medium" | "low" | null;
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
  // Per-round durations (seconds) when this is a captureDurationPerRound
  // movement. Length matches part.rounds.
  actualDurationSecondsPerRound?: number[];
  // Per-round captured weight (lb) when this movement is athlete-weight
  // (weightSource === "athlete"). Length matches part.rounds; empty slots
  // round-trip as 0.
  actualWeightLbsPerRound?: number[];
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
  // Dependents (family_memberships): the account holder is logging a
  // score on behalf of a dependent. The server validates that the
  // current user manages this dependent in the workout's gym.
  forUserId?: string;
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
  // Per-round durations for timed_rounds. The server computes the aggregate
  // (slowest / fastest / sum / average) from this array and writes it to
  // scores.time_seconds.
  roundDurationsSeconds?: number[];
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
  actualDurationSecondsPerRound?: number[];
  actualWeightLbsPerRound?: number[];
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
  // Phase 2 movement settings. Carried on the builder movement so the
  // data-driven render path can iterate the Rx fields without re-fetching.
  // Undefined / empty falls back to the legacy hardcoded branches in
  // MovementListBuilder (rollback insurance).
  supportedMetricTypes?: MovementMetricType[];
  rxFields?: RxField[];
  rxDefaults?: RxDefaults;
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
  // Gendered Rx heights (e.g. box jump 24"/20"). When populated, take
  // precedence over the legacy single-value `prescribedHeightInches` at
  // save time.
  prescribedHeightInchesMale: string;
  prescribedHeightInchesFemale: string;
  // Builder-only flag: when true, the BW-multiplier inputs are surfaced
  // and the absolute lb fields are ignored on save. Lets the user pick
  // one notation explicitly without forcing them to clear the other.
  useBwMultiplier?: boolean;
  prescribedWeightMaleBwMultiplier: string;
  prescribedWeightFemaleBwMultiplier: string;
  // weight_pct Rx — builder-only. When `useWeightPct` is on, the movement's
  // working weight is a percentage of the max load logged on an earlier
  // for_load part. `weightPctSourcePartTempRef` references that part's
  // builder tempId — the save path resolves it to a real workout_parts id.
  useWeightPct?: boolean;
  prescribedWeightPct: string;
  weightPctSourcePartTempRef?: string | null;
  tempo: string;
  // When true, the prescribedReps field is suppressed and the score-entry
  // surfaces per-round rep inputs that auto-sum into the part's total.
  isMaxReps?: boolean;
  // When true the athlete logs one duration per round at score entry
  // (e.g. "Run 400m × 3 as fast as possible"). Sums into the part's total
  // time. Mutually exclusive with isMaxReps.
  captureDurationPerRound?: boolean;
  // When true, this movement is the part's side-cadence movement (runs
  // on the part's cadence rather than contributing to the main task).
  isSideCadence?: boolean;
  equipmentCount?: number;
  rxStandard: string;
  notes: string;
  // 'prescribed' (default): builder shows M/F Rx weight inputs.
  // 'athlete': weight is captured at score time per round; M/F Rx fields
  // are hidden and not emitted on save. Only meaningful when isWeighted.
  weightSource: WeightSource;
  // Optional block membership. `blockTempRef` references a
  // WorkoutBuilderBlock.tempId on the same part — newly-created blocks are
  // wired to movements via tempRef and resolved to a real block id on save.
  // `blockId` is the round-tripped DB id when editing existing rows; the
  // server resolves it to the same target as `blockTempRef`.
  blockTempRef?: string | null;
  blockId?: string | null;
}

export interface WorkoutBuilderBlock {
  tempId: string;
  // Real DB id when editing an existing benchmark/workout. Undefined for
  // newly-added blocks; the server inserts and assigns the id.
  id?: string;
  title: string;
  orderIndex: number;
}

export interface WorkoutBuilderPart {
  tempId: string;
  // Real DB id when editing an existing workout. Undefined for newly added
  // parts; used by the diff-based update endpoint to preserve scores on
  // existing parts.
  id?: string;
  label: string;
  workoutType: WorkoutType;
  // All duration fields are free-text mm:ss-style strings (":30", "1:30",
  // "90s", or a bare number = seconds). Parsed to seconds at the API
  // boundary via parseDurationToSeconds(). Names use the DB unit (seconds)
  // even though the input format is mm:ss — the field carries the user's
  // raw string until submit.
  timeCapInput: string;
  amrapDurationInput: string;
  emomIntervalInput: string;
  // "Intervals" workout type: per-round work + rest cadence. Free-text
  // mm:ss strings like the other duration fields above. When
  // `intervalRounds` is populated the per-round array takes precedence
  // over these uniform values.
  intervalWorkInput: string;
  intervalRestInput: string;
  // Per-round (work, rest) override. Each entry's strings are mm:ss-style
  // and get parsed on save. Length should equal `rounds`. Use this when
  // the rounds aren't uniform (e.g. 4:00/4:00 → 3:00/3:00 → 2:00/2:00).
  intervalRounds?: { workInput: string; restInput: string }[];
  // Side-cadence: pairs the part with a recurring side movement (e.g.
  // EMOM 5 burpees). Free-text mm:ss like the duration fields.
  sideCadenceIntervalInput?: string;
  sideCadenceOpenEnded?: boolean;
  // Workout-level rep scheme. Retained on the type for legacy / parsed
  // workouts; the Smart Builder no longer surfaces it directly — for_load
  // expresses its scheme per-movement via `prescribedReps`, and round-based
  // workouts use `rounds` below.
  repScheme: string;
  // Builder-only mirror of the per-movement `promoteSequenceToLadder` flag.
  // Holds the part-level "Continue as ladder?" toggle while the user is
  // editing the shared rep scheme; gets propagated onto each movement that
  // inherits the part's scheme. Not persisted — the wire only carries the
  // per-movement flag.
  promoteSequenceToLadder?: boolean;
  rounds: string;
  structure?: WorkoutPartStructure;
  // Admin override for parts where the workout type is ambiguous
  // (for_reps / amrap / intervals) AND at least one movement has
  // weightSource === "athlete". 'reps' (default when picker shown) ranks
  // the leaderboard by total reps and shows heaviest weight as a chip;
  // 'load' ranks by heaviest weight used. Undefined elsewhere — reader
  // treats undefined as "derive from workout_type" (legacy behavior).
  scoreType?: PartScoreType;
  // Timed Rounds — aggregation strategy + optional per-round window.
  // `roundWindowInput` is the free-text mm:ss-style string the builder
  // carries until submit; the server parses it via parseDurationToSeconds.
  roundScoreAggregation?: RoundScoreAggregation;
  roundWindowInput?: string;
  movements: WorkoutBuilderMovement[];
  // Named groupings under this part. Empty = ungrouped flat rendering.
  // Each movement either references a block via `blockTempRef`/`blockId`
  // or is rendered ungrouped.
  blocks: WorkoutBuilderBlock[];
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
  // Partner / team workout flag. Description carries the split strategy.
  isPartner?: boolean;
  partnerCount?: string;
}

// ============================================
// Leaderboard Types
// ============================================

export interface LeaderboardEntry {
  scoreId: string;
  userId: string;
  userName: string;
  userUsername?: string | null;
  userImage?: string | null;
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
  /** Heaviest weight (lb) the athlete used across rounds. Set only when
   *  the part has at least one `weightSource: "athlete"` movement AND
   *  the part's effective scoreType is "reps" (i.e. the chip is a
   *  secondary signal, not the rank key). When scoreType === "load" the
   *  weight is the displayScore + sort key and this stays unset. */
  heaviestAthleteWeightLb?: number | null;
  // Social — added per spec §7.
  reactionCount: number;
  commentCount: number;
  viewerReacted: boolean;
  createdAt: string;
}

// ============================================
// Movement Library
// ============================================

// Subset of rx_fields supported in the data-driven MovementListBuilder.
// New entries here unlock new inputs without code changes elsewhere.
export const RX_FIELDS = [
  "weight",
  "weight_bw",
  "weight_pct",
  "height",
  "calories",
  "distance",
  "duration",
  "tempo",
] as const;

export type RxField = (typeof RX_FIELDS)[number];

// Per-field defaults stored on the movement itself. Gendered keys for
// fields that have an Rx M/F split. Only the keys relevant to the
// movement's rx_fields are populated.
export interface RxDefaults {
  weight_male?: number | string;
  weight_female?: number | string;
  weight_bw_male?: number | string;
  weight_bw_female?: number | string;
  // Default percentage for the weight_pct field (e.g. 60 for 60%). Not
  // gendered — a % of the athlete's own max applies the same either way.
  weight_pct?: number | string;
  height_inches_male?: number | string;
  height_inches_female?: number | string;
  calories_male?: number | string;
  calories_female?: number | string;
  distance_male?: number | string;
  distance_female?: number | string;
  duration_seconds_male?: number;
  duration_seconds_female?: number;
  tempo?: string;
}

export interface MovementOption {
  id: string;
  canonicalName: string;
  category: MovementCategory;
  isWeighted: boolean;
  is1rmApplicable: boolean;
  metricType: MovementMetricType;
  // All metrics this movement can be scored in (Phase 2 movement settings).
  // The builder picks one per workout instance via metricType. Falls back
  // to [metricType] when undefined (un-backfilled rows).
  supportedMetricTypes?: MovementMetricType[];
  // Rx inputs the builder surfaces. Empty/undefined = legacy hardcoded
  // branches (rollback insurance).
  rxFields?: RxField[];
  rxDefaults?: RxDefaults;
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

// ============================================
// Movement Videos
// ============================================

export type CrossfitVideoVisibility = "public" | "gym" | "private";
export type CrossfitVideoSource = "upload" | "external";

export interface CrossfitMovementVideo {
  id: string;
  movementId: string;
  sourceType: CrossfitVideoSource;
  storagePath: string | null;
  externalUrl: string | null;
  externalProvider: string | null;
  externalVideoId: string | null;
  visibility: CrossfitVideoVisibility;
  communityId: string | null;
  label: string | null;
  durationSeconds: number | null;
  posterStoragePath: string | null;
  rightsConfirmed: boolean;
  orderIndex: number;
  uploadedBy: string;
  createdAt: string;
}
