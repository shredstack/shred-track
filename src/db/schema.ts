import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  date,
  jsonb,
  uniqueIndex,
  index,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { TimeLossEntry, FocusEntry } from "@/types/hyrox-race-report";
import type {
  SetEntry,
  NotesComplaint,
  NotesScalingReason,
  NotesMilestone,
} from "@/types/crossfit";

// ============================================
// Users & Auth
// ============================================

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").unique().notNull(),
  name: text("name").notNull(),
  gender: text("gender"), // 'male' | 'female' | 'other'
  unitPreference: text("unit_preference").default("mixed").notNull(), // 'metric' | 'mixed'
  image: text("image"),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  isAdmin: boolean("is_admin").default(false).notNull(),
  isVip: boolean("is_vip").default(false).notNull(),
  // Canonical store: lb. Drives BW-multiplier Rx resolution.
  bodyWeightLb: numeric("body_weight_lb"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const accounts = pgTable("accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  refreshToken: text("refresh_token"),
  accessToken: text("access_token"),
  expiresAt: integer("expires_at"),
  tokenType: text("token_type"),
  scope: text("scope"),
  idToken: text("id_token"),
  sessionState: text("session_state"),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionToken: text("session_token").unique().notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (table) => [uniqueIndex("verification_tokens_identifier_token").on(table.identifier, table.token)]
);

// ============================================
// Communities
// ============================================

export const communities = pgTable("communities", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  joinCode: text("join_code").unique().notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const communityMemberships = pgTable(
  "community_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    communityId: uuid("community_id").notNull().references(() => communities.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"), // 'admin' | 'member'
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("community_memberships_unique").on(table.communityId, table.userId)]
);

// ============================================
// CrossFit: Movements
// ============================================

export const movements = pgTable(
  "movements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    canonicalName: text("canonical_name").notNull(),
    category: text("category").notNull(), // barbell | dumbbell | kettlebell | gymnastics | bodyweight | monostructural | accessory | other
    isWeighted: boolean("is_weighted").default(false).notNull(),
    is1rmApplicable: boolean("is_1rm_applicable").default(false).notNull(),
    metricType: text("metric_type").default("reps").notNull(), // 'reps' | 'weight' | 'calories' | 'distance' | 'duration' (legacy single value; superseded by supportedMetricTypes for new code paths)
    // All metric types this movement can be scored in. The user picks one
    // per workout instance via workout_movements.metric_type. Drives the
    // builder's "scoring metric" toggle.
    supportedMetricTypes: text("supported_metric_types").array().default(sql`ARRAY['reps']::text[]`).notNull(),
    // Rx inputs the builder surfaces when adding the movement. Subset of:
    // 'weight' | 'weight_bw' | 'height' | 'calories' | 'distance' |
    // 'duration' | 'tempo'. Empty array = legacy hardcoded-branch fallback
    // (the rollback insurance described in the Phase 2 spec).
    rxFields: text("rx_fields").array().default(sql`ARRAY[]::text[]`).notNull(),
    // Per-field defaults, gendered where it matters. Examples:
    // {"height_inches_male": 24, "height_inches_female": 20} for Box Jump.
    rxDefaults: jsonb("rx_defaults").default(sql`'{}'::jsonb`).notNull(),
    commonRxWeightMale: numeric("common_rx_weight_male"),
    commonRxWeightFemale: numeric("common_rx_weight_female"),
    videoUrl: text("video_url"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    isValidated: boolean("is_validated").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("movements_created_by_idx").on(table.createdBy)]
);

// ============================================
// CrossFit: Workouts
// ============================================

export const workouts = pgTable("workouts", {
  id: uuid("id").defaultRandom().primaryKey(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  communityId: uuid("community_id").references(() => communities.id),
  title: text("title"),
  description: text("description"),
  rawText: text("raw_text"),
  workoutType: text("workout_type").notNull(), // for_time | amrap | for_load | for_reps | for_calories | emom | tabata | max_effort | other
  timeCapSeconds: integer("time_cap_seconds"),
  amrapDurationSeconds: integer("amrap_duration_seconds"),
  repScheme: text("rep_scheme"),
  rounds: integer("rounds"),
  workoutDate: date("workout_date").notNull(),
  published: boolean("published").default(false).notNull(),
  source: text("source").default("manual").notNull(), // 'manual' | 'parsed' | 'import' | 'benchmark'
  benchmarkWorkoutId: uuid("benchmark_workout_id").references(() => benchmarkWorkouts.id, { onDelete: "set null" }),
  // Vest prescription. Vest is workout-level (Murph wants the vest the
  // whole way) — not per-part.
  requiresVest: boolean("requires_vest").default(false).notNull(),
  vestWeightMaleLb: numeric("vest_weight_male_lb"),
  vestWeightFemaleLb: numeric("vest_weight_female_lb"),
  // Partner / team workouts. Description carries the split strategy.
  isPartner: boolean("is_partner").default(false).notNull(),
  partnerCount: integer("partner_count"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const workoutParts = pgTable(
  "workout_parts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workoutId: uuid("workout_id").notNull().references(() => workouts.id, { onDelete: "cascade" }),
    orderIndex: integer("order_index").notNull(),
    label: text("label"),
    workoutType: text("workout_type").notNull(),
    timeCapSeconds: integer("time_cap_seconds"),
    amrapDurationSeconds: integer("amrap_duration_seconds"),
    emomIntervalSeconds: integer("emom_interval_seconds"),
    repScheme: text("rep_scheme"),
    rounds: integer("rounds"),
    // Structural pattern modifier for the part (currently 'tabata' on for_reps,
    // null otherwise). Lets a "For Reps" part declare a Tabata cadence without
    // creating a new workout_type.
    structure: text("structure"),
    // Populated only on the new "intervals" workout type — work + rest
    // alternation per round (e.g. 8 rounds × 1:00 work / 3:00 rest).
    // Legacy: single (work, rest) pair applied uniformly across `rounds`.
    // When the user wants per-round variance (4:00/4:00 → 3:00/3:00 →
    // 2:00/2:00 etc.), `intervalRounds` carries the array and the legacy
    // columns are ignored.
    intervalWorkSeconds: integer("interval_work_seconds"),
    intervalRestSeconds: integer("interval_rest_seconds"),
    intervalRounds: jsonb("interval_rounds"),
    // Side-cadence: a per-minute (or other interval) burst-movement that
    // runs concurrently with the part's main task. Lets the builder
    // express "150 DB hang power cleans for time, EMOM 5 burpees".
    sideCadenceIntervalSeconds: integer("side_cadence_interval_seconds"),
    sideCadenceOpenEnded: boolean("side_cadence_open_ended").default(false).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("workout_parts_workout_order_unique").on(table.workoutId, table.orderIndex),
    index("workout_parts_workout_id_idx").on(table.workoutId),
  ]
);

export const workoutBlocks = pgTable(
  "workout_blocks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workoutPartId: uuid("workout_part_id").notNull().references(() => workoutParts.id, { onDelete: "cascade" }),
    orderIndex: integer("order_index").notNull(),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("workout_blocks_part_order_unique").on(table.workoutPartId, table.orderIndex),
    index("workout_blocks_part_id_idx").on(table.workoutPartId),
  ]
);

export const workoutMovements = pgTable("workout_movements", {
  id: uuid("id").defaultRandom().primaryKey(),
  workoutId: uuid("workout_id").notNull().references(() => workouts.id, { onDelete: "cascade" }),
  workoutPartId: uuid("workout_part_id").references(() => workoutParts.id, { onDelete: "cascade" }),
  // Optional grouping under a part. Null = ungrouped (legacy / flat
  // rendering). Block headers appear in score-entry and previews when set.
  workoutBlockId: uuid("workout_block_id").references(() => workoutBlocks.id, { onDelete: "set null" }),
  movementId: uuid("movement_id").notNull().references(() => movements.id),
  orderIndex: integer("order_index").notNull(),
  prescribedReps: text("prescribed_reps"),
  prescribedWeightMale: numeric("prescribed_weight_male"),
  prescribedWeightFemale: numeric("prescribed_weight_female"),
  // Free-text so rep schemes ("75-50-25") work alongside scalar values
  // ("21"). Parsed via the rep-scheme parser at display / score-entry
  // time.
  prescribedCaloriesMale: text("prescribed_calories_male"),
  prescribedCaloriesFemale: text("prescribed_calories_female"),
  prescribedDistanceMale: text("prescribed_distance_male"), // meters
  prescribedDistanceFemale: text("prescribed_distance_female"), // meters
  prescribedDurationSecondsMale: integer("prescribed_duration_seconds_male"),
  prescribedDurationSecondsFemale: integer("prescribed_duration_seconds_female"),
  // Override height for deficit pushups, box jumps, etc. (inches).
  // The legacy single-column field is retained as a read fallback; new
  // writes go to the gendered pair below so box jump 24"/20" is
  // expressible without the user having to scale at score-entry time.
  prescribedHeightInches: numeric("prescribed_height_inches"),
  prescribedHeightInchesMale: numeric("prescribed_height_inches_male"),
  prescribedHeightInchesFemale: numeric("prescribed_height_inches_female"),
  // BW-multiplier Rx (e.g. 1.5 means "1.5 × bodyweight"). Mutually
  // exclusive with the absolute lb fields per gender — enforced in the
  // builder, not the DB.
  prescribedWeightMaleBwMultiplier: numeric("prescribed_weight_male_bw_multiplier"),
  prescribedWeightFemaleBwMultiplier: numeric("prescribed_weight_female_bw_multiplier"),
  // Free-text tempo prescription, e.g. "30X1".
  tempo: text("tempo"),
  // When true the movement is the score-bearing movement of its part:
  // the athlete logs per-round rep counts during score entry, and we sum
  // them into totalReps. Mutually exclusive with prescribedReps at the
  // UI layer.
  isMaxReps: boolean("is_max_reps").default(false).notNull(),
  // When true, this movement is the side-cadence movement (performed at
  // the part's cadence) rather than part of the main task. See workout_parts.
  isSideCadence: boolean("is_side_cadence").default(false).notNull(),
  repSchemeParsed: jsonb("rep_scheme_parsed"), // RepSchemeParsed | null — see lib/crossfit/rep-scheme-parser.ts
  equipmentCount: integer("equipment_count"),
  rxStandard: text("rx_standard"),
  notes: text("notes"),
});

// ============================================
// CrossFit: Scores
// ============================================

export const scores = pgTable(
  "scores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workoutId: uuid("workout_id").notNull().references(() => workouts.id, { onDelete: "cascade" }),
    workoutPartId: uuid("workout_part_id").references(() => workoutParts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id),
    division: text("division").notNull(), // 'rx' | 'scaled' | 'rx_plus'
    timeSeconds: integer("time_seconds"),
    rounds: integer("rounds"),
    remainderReps: integer("remainder_reps"),
    weightLbs: numeric("weight_lbs"),
    totalReps: integer("total_reps"),
    scoreText: text("score_text"),
    hitTimeCap: boolean("hit_time_cap").default(false).notNull(),
    notes: text("notes"),
    rpe: integer("rpe"), // 1-10
    // Vest the athlete actually wore (only meaningful when the workout
    // requires a vest). Lets a Murph-without-vest score show a badge
    // without flipping the division to scaled.
    woreVest: boolean("wore_vest"),
    vestWeightLb: numeric("vest_weight_lb"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("scores_part_user_unique").on(table.workoutPartId, table.userId),
    index("scores_part_idx").on(table.workoutPartId),
  ]
);

export const scoreMovementDetails = pgTable("score_movement_details", {
  id: uuid("id").defaultRandom().primaryKey(),
  scoreId: uuid("score_id").notNull().references(() => scores.id, { onDelete: "cascade" }),
  workoutMovementId: uuid("workout_movement_id").notNull(),
  wasRx: boolean("was_rx").default(true).notNull(),
  actualWeight: numeric("actual_weight"),
  actualReps: text("actual_reps"),
  modification: text("modification"),
  substitutionMovementId: uuid("substitution_movement_id").references(() => movements.id),
  // Per-set entries on for_load parts: [{ weight, reps?, rpe? }]. Column
  // name kept as `set_weights` for migration simplicity. Use `setEntries`
  // when reading/writing in code.
  setEntries: jsonb("set_weights").$type<SetEntry[]>(),
  // "I held the L-sit for :22" / "did 3" deficit instead of 4""
  actualDurationSeconds: integer("actual_duration_seconds"),
  actualHeightInches: numeric("actual_height_inches"),
  // Per-round rep counts for max-reps movements. Length matches part.rounds.
  actualRepsPerRound: integer("actual_reps_per_round").array(),
  notes: text("notes"),
}, (table) => [
  foreignKey({
    name: "smd_workout_movement_id_fk",
    columns: [table.workoutMovementId],
    foreignColumns: [workoutMovements.id],
  }),
]);

// ============================================
// CrossFit: Benchmark Workouts
// ============================================

export const benchmarkWorkouts = pgTable("benchmark_workouts", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  workoutType: text("workout_type").notNull(),
  // 'girls' | 'heroes' | 'open' | 'weightlifting' | 'gym_benchmark'.
  // Nullable so user-created custom benchmarks don't have to be classified.
  category: text("category"),
  timeCapSeconds: integer("time_cap_seconds"),
  amrapDurationSeconds: integer("amrap_duration_seconds"),
  repScheme: text("rep_scheme"),
  createdBy: uuid("created_by").references(() => users.id),
  communityId: uuid("community_id").references(() => communities.id),
  isSystem: boolean("is_system").default(false).notNull(),
  // Vest fields mirror the workouts table so benchmark seeds (Murph, Chad)
  // can prescribe the vest as a first-class field.
  requiresVest: boolean("requires_vest").default(false).notNull(),
  vestWeightMaleLb: numeric("vest_weight_male_lb"),
  vestWeightFemaleLb: numeric("vest_weight_female_lb"),
  // Partner / team flag — inherited onto user workouts created from this
  // benchmark.
  isPartner: boolean("is_partner").default(false).notNull(),
  partnerCount: integer("partner_count"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// One row per user, holds the rendered DomainProfile JSON. See
// claude_code_instructions/crossfit_smart_insights_spec.md §9.5.
export const crossfitInsightsCache = pgTable("crossfit_insights_cache", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  domainProfile: jsonb("domain_profile").notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
  sourceScoreCount: integer("source_score_count").notNull(),
});

// LLM-extracted structured signal from a score's free-text notes. Keyed by
// score so re-extraction (e.g. on a model bump or note edit) is idempotent.
// `contentHash` is a fingerprint of the prompt we sent the LLM — when notes
// or scaling context change, the hash flips and we re-extract.
// See claude_code_instructions/crossfit_smart_insights_spec.md §11.
export const scoreNotesExtractions = pgTable("score_notes_extractions", {
  scoreId: uuid("score_id").primaryKey().references(() => scores.id, { onDelete: "cascade" }),
  complaints: jsonb("complaints").$type<NotesComplaint[]>().notNull(),
  scalingRationale: jsonb("scaling_rationale").$type<NotesScalingReason[]>().notNull(),
  milestones: jsonb("milestones").$type<NotesMilestone[]>().notNull(),
  extractedAt: timestamp("extracted_at", { withTimezone: true }).defaultNow().notNull(),
  modelVersion: text("model_version").notNull(),
  contentHash: text("content_hash"),
});

export const benchmarkWorkoutParts = pgTable(
  "benchmark_workout_parts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    benchmarkWorkoutId: uuid("benchmark_workout_id")
      .notNull()
      .references(() => benchmarkWorkouts.id, { onDelete: "cascade" }),
    orderIndex: integer("order_index").notNull(),
    label: text("label"),
    workoutType: text("workout_type").notNull(),
    timeCapSeconds: integer("time_cap_seconds"),
    amrapDurationSeconds: integer("amrap_duration_seconds"),
    emomIntervalSeconds: integer("emom_interval_seconds"),
    repScheme: text("rep_scheme"),
    rounds: integer("rounds"),
    structure: text("structure"),
    intervalWorkSeconds: integer("interval_work_seconds"),
    intervalRestSeconds: integer("interval_rest_seconds"),
    intervalRounds: jsonb("interval_rounds"),
    sideCadenceIntervalSeconds: integer("side_cadence_interval_seconds"),
    sideCadenceOpenEnded: boolean("side_cadence_open_ended").default(false).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("benchmark_workout_parts_workout_order_unique").on(
      table.benchmarkWorkoutId,
      table.orderIndex
    ),
    index("benchmark_workout_parts_benchmark_id_idx").on(table.benchmarkWorkoutId),
  ]
);

export const benchmarkWorkoutBlocks = pgTable(
  "benchmark_workout_blocks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    benchmarkWorkoutPartId: uuid("benchmark_workout_part_id")
      .notNull()
      .references(() => benchmarkWorkoutParts.id, { onDelete: "cascade" }),
    orderIndex: integer("order_index").notNull(),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("benchmark_workout_blocks_part_order_unique").on(
      table.benchmarkWorkoutPartId,
      table.orderIndex
    ),
    index("benchmark_workout_blocks_part_id_idx").on(table.benchmarkWorkoutPartId),
  ]
);

export const benchmarkWorkoutMovements = pgTable("benchmark_workout_movements", {
  id: uuid("id").defaultRandom().primaryKey(),
  benchmarkWorkoutId: uuid("benchmark_workout_id").notNull().references(() => benchmarkWorkouts.id, { onDelete: "cascade" }),
  // FK to the part. Backfilled to point at the synthetic order-0 part on
  // existing single-part benchmarks. New benchmarks should always set
  // this; nullable today for legacy compatibility.
  benchmarkWorkoutPartId: uuid("benchmark_workout_part_id").references(
    () => benchmarkWorkoutParts.id,
    { onDelete: "cascade" }
  ),
  // Optional grouping under a part. Null = ungrouped within the part.
  benchmarkWorkoutBlockId: uuid("benchmark_workout_block_id").references(
    () => benchmarkWorkoutBlocks.id,
    { onDelete: "set null" }
  ),
  movementId: uuid("movement_id").notNull().references(() => movements.id),
  orderIndex: integer("order_index").notNull(),
  prescribedReps: text("prescribed_reps"),
  prescribedWeightMale: numeric("prescribed_weight_male"),
  prescribedWeightFemale: numeric("prescribed_weight_female"),
  prescribedCaloriesMale: text("prescribed_calories_male"),
  prescribedCaloriesFemale: text("prescribed_calories_female"),
  prescribedDistanceMale: text("prescribed_distance_male"),
  prescribedDistanceFemale: text("prescribed_distance_female"),
  prescribedDurationSecondsMale: integer("prescribed_duration_seconds_male"),
  prescribedDurationSecondsFemale: integer("prescribed_duration_seconds_female"),
  prescribedHeightInches: numeric("prescribed_height_inches"),
  prescribedHeightInchesMale: numeric("prescribed_height_inches_male"),
  prescribedHeightInchesFemale: numeric("prescribed_height_inches_female"),
  prescribedWeightMaleBwMultiplier: numeric("prescribed_weight_male_bw_multiplier"),
  prescribedWeightFemaleBwMultiplier: numeric("prescribed_weight_female_bw_multiplier"),
  tempo: text("tempo"),
  isMaxReps: boolean("is_max_reps").default(false).notNull(),
  isSideCadence: boolean("is_side_cadence").default(false).notNull(),
  repSchemeParsed: jsonb("rep_scheme_parsed"),
  equipmentCount: integer("equipment_count"),
  rxStandard: text("rx_standard"),
  notes: text("notes"),
});

// ============================================
// HYROX: Profile & Assessments
// ============================================

export const hyroxProfiles = pgTable("hyrox_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").unique().notNull().references(() => users.id),
  name: text("name"),
  gender: text("gender"),
  preferredUnits: text("preferred_units").default("metric"),
  targetDivision: text("target_division").notNull(),
  nextRaceDate: date("next_race_date"),
  easyPaceSecondsPerUnit: integer("easy_pace_seconds_per_unit"),
  moderatePaceSecondsPerUnit: integer("moderate_pace_seconds_per_unit"),
  fastPaceSecondsPerUnit: integer("fast_pace_seconds_per_unit"),
  recent5kTimeSeconds: integer("recent_5k_time_seconds"),
  recent800mRepeatSeconds: integer("recent_800m_repeat_seconds"),
  paceUnit: text("pace_unit").default("mile").notNull(),
  previousRaceCount: integer("previous_race_count").default(0).notNull(),
  bestFinishTimeSeconds: integer("best_finish_time_seconds"),
  bestDivision: text("best_division"),
  bestTimeNotes: text("best_time_notes"),
  goalFinishTimeSeconds: integer("goal_finish_time_seconds"),
  crossfitDaysPerWeek: integer("crossfit_days_per_week").default(5),
  crossfitGymName: text("crossfit_gym_name"),
  availableEquipment: text("available_equipment").array().default([]),
  injuriesNotes: text("injuries_notes"),
  trainingPhilosophy: text("training_philosophy").default("moderate"), // 'conservative' | 'moderate' | 'aggressive'
  onboardingVersion: integer("onboarding_version").default(1),
  paceTier: text("pace_tier"), // 'beginner' | 'intermediate' | 'advanced' | 'elite' — populated only for free-flow users
  planTier: text("plan_tier").default("free").notNull(), // 'free' | 'personalized'
  disclaimerAcceptedAt: timestamp("disclaimer_accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const hyroxStationAssessments = pgTable(
  "hyrox_station_assessments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    profileId: uuid("profile_id").notNull().references(() => hyroxProfiles.id, { onDelete: "cascade" }),
    station: text("station").notNull(),
    completionConfidence: integer("completion_confidence").notNull(),
    currentTimeSeconds: integer("current_time_seconds"),
    goalTimeSeconds: integer("goal_time_seconds"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("station_assessments_unique").on(table.profileId, table.station)]
);

// ============================================
// HYROX: Training Plans
// ============================================

export const hyroxTrainingPlans = pgTable("hyrox_training_plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  totalWeeks: integer("total_weeks").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  planType: text("plan_type").notNull(),
  status: text("status").default("active").notNull(),
  paceScaleFactor: numeric("pace_scale_factor").notNull(),
  generationStatus: text("generation_status").default("pending"), // 'pending' | 'generating' | 'completed' | 'failed'
  inngestRunId: text("inngest_run_id"),
  aiModel: text("ai_model"),
  trainingPhilosophy: jsonb("training_philosophy"),
  athleteSnapshot: jsonb("athlete_snapshot"),
  recalibrationSuggestedAt: timestamp("recalibration_suggested_at", { withTimezone: true }),
  recalibrationSourceRaceId: uuid("recalibration_source_race_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const hyroxPlanPhases = pgTable(
  "hyrox_plan_phases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    planId: uuid("plan_id").notNull().references(() => hyroxTrainingPlans.id, { onDelete: "cascade" }),
    phaseNumber: integer("phase_number").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    startWeek: integer("start_week").notNull(),
    endWeek: integer("end_week").notNull(),
    focusAreas: text("focus_areas").array().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("plan_phases_unique").on(table.planId, table.phaseNumber)]
);

export const hyroxPlanSessions = pgTable("hyrox_plan_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  planId: uuid("plan_id").notNull().references(() => hyroxTrainingPlans.id, { onDelete: "cascade" }),
  week: integer("week").notNull(),
  dayOfWeek: integer("day_of_week").notNull(),
  sessionType: text("session_type").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  targetPace: text("target_pace"),
  durationMinutes: integer("duration_minutes"),
  phase: text("phase").notNull(),
  orderInDay: integer("order_in_day").default(1).notNull(),
  phaseId: uuid("phase_id").references(() => hyroxPlanPhases.id),
  aiGenerated: boolean("ai_generated").default(true),
  athleteModified: boolean("athlete_modified").default(false),
  originalSessionData: jsonb("original_session_data"),
  sessionDetail: jsonb("session_detail"),
  equipmentRequired: text("equipment_required").array().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const hyroxSessionLogs = pgTable(
  "hyrox_session_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    planSessionId: uuid("plan_session_id").notNull().references(() => hyroxPlanSessions.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    status: text("status").notNull(), // 'completed' | 'skipped' | 'modified'
    actualPace: text("actual_pace"),
    actualPaceUnit: text("actual_pace_unit"), // 'mi' | 'km'
    actualTimeSeconds: integer("actual_time_seconds"),
    actualReps: integer("actual_reps"),
    actualDistance: text("actual_distance"),
    actualDistanceValue: numeric("actual_distance_value", { precision: 8, scale: 2 }),
    actualDistanceUnit: text("actual_distance_unit"), // 'mi' | 'km'
    actualWeight: text("actual_weight"),
    actualWeightValue: numeric("actual_weight_value", { precision: 8, scale: 2 }),
    actualWeightUnit: text("actual_weight_unit"), // 'kg' | 'lb'
    movementResults: jsonb("movement_results"), // MovementResult[]
    rpe: integer("rpe"),
    notes: text("notes"),
    loggedAt: timestamp("logged_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("session_logs_unique").on(table.planSessionId, table.userId)]
);

export const hyroxStationBenchmarks = pgTable(
  "hyrox_station_benchmarks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    station: text("station").notNull(),
    timeSeconds: integer("time_seconds").notNull(),
    loggedAt: timestamp("logged_at", { withTimezone: true }).defaultNow().notNull(),
    source: text("source"),
    notes: text("notes"),
    sourceRaceId: uuid("source_race_id"),
  },
  (table) => [
    index("benchmarks_user_station").on(table.userId, table.station, table.loggedAt),
    index("benchmarks_source_race").on(table.sourceRaceId),
  ]
);

// ============================================
// HYROX: Race Day Scenarios
// ============================================

export const hyroxRaceScenarios = pgTable("hyrox_race_scenarios", {
  id: uuid("id").defaultRandom().primaryKey(),
  planId: uuid("plan_id").notNull().references(() => hyroxTrainingPlans.id, { onDelete: "cascade" }),
  scenarioLabel: text("scenario_label").notNull(),
  description: text("description").notNull(),
  estimatedFinishSeconds: integer("estimated_finish_seconds").notNull(),
  bufferSeconds: integer("buffer_seconds"),
  runStrategy: text("run_strategy").notNull(),
  splits: jsonb("splits").notNull().default([]),
  analysis: text("analysis"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ============================================
// HYROX: Generic Plan Templates (free-flow source of truth)
// ============================================

export const hyroxGenericPlanTemplates = pgTable(
  "hyrox_generic_plan_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    templateKey: text("template_key").notNull(), // e.g. 'women_singles_intermediate'
    gender: text("gender").notNull(), // 'women' | 'men'
    raceFormat: text("race_format").notNull(), // 'singles' | 'doubles' | 'relay'
    paceTier: text("pace_tier").notNull(), // 'beginner' | 'intermediate' | 'advanced' | 'elite'
    weightTier: text("weight_tier").notNull(), // 'open' | 'pro' — relay is always 'open'
    totalWeeks: integer("total_weeks").default(18).notNull(),
    title: text("title").notNull(),
    trainingPhilosophy: text("training_philosophy").notNull(),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("generic_plan_templates_key_weight").on(table.templateKey, table.weightTier),
    index("idx_generic_plan_templates_lookup").on(table.gender, table.raceFormat, table.paceTier, table.weightTier),
  ]
);

export const hyroxGenericPlanTemplatePhases = pgTable(
  "hyrox_generic_plan_template_phases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    templateId: uuid("template_id").notNull().references(() => hyroxGenericPlanTemplates.id, { onDelete: "cascade" }),
    phaseNumber: integer("phase_number").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    startWeek: integer("start_week").notNull(),
    endWeek: integer("end_week").notNull(),
    focusAreas: text("focus_areas").array().default([]).notNull(),
  },
  (table) => [uniqueIndex("generic_plan_template_phases_unique").on(table.templateId, table.phaseNumber)]
);

export const hyroxGenericPlanTemplateSessions = pgTable(
  "hyrox_generic_plan_template_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    templateId: uuid("template_id").notNull().references(() => hyroxGenericPlanTemplates.id, { onDelete: "cascade" }),
    week: integer("week").notNull(),
    dayOfWeek: integer("day_of_week").notNull(),
    orderInDay: integer("order_in_day").default(1).notNull(),
    sessionType: text("session_type").notNull(), // 'station_skills' | 'run' | 'hyrox_day' | 'rest'
    title: text("title").notNull(),
    description: text("description").notNull(),
    paceSpec: jsonb("pace_spec"), // PaceSpec | null
    durationMinutes: integer("duration_minutes"),
    sessionDetail: jsonb("session_detail").notNull(),
    equipmentRequired: text("equipment_required").array().default([]).notNull(),
    phaseNumber: integer("phase_number").notNull(),
  },
  (table) => [
    uniqueIndex("generic_plan_template_sessions_unique").on(table.templateId, table.week, table.dayOfWeek, table.orderInDay),
    index("idx_generic_plan_sessions_template_week").on(table.templateId, table.week),
  ]
);

// ============================================
// HYROX: Division Reference Data
// ============================================

export const hyroxDivisions = pgTable("hyrox_divisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  divisionKey: text("division_key").unique().notNull(),
  category: text("category").notNull(), // 'single' | 'double' | 'relay'
  genderLabel: text("gender_label").notNull(),
  displayOrder: integer("display_order").notNull(),
});

export const hyroxDivisionStations = pgTable(
  "hyrox_division_stations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    divisionId: uuid("division_id").notNull().references(() => hyroxDivisions.id, { onDelete: "cascade" }),
    station: text("station").notNull(),
    distanceMeters: numeric("distance_meters"),
    reps: integer("reps"),
    weightKg: numeric("weight_kg"),
    weightNote: text("weight_note"),
  },
  (table) => [uniqueIndex("division_stations_unique").on(table.divisionId, table.station)]
);

export const hyroxStationReferenceTimes = pgTable(
  "hyrox_station_reference_times",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    divisionId: uuid("division_id").notNull().references(() => hyroxDivisions.id, { onDelete: "cascade" }),
    station: text("station").notNull(),
    proBenchmarkSeconds: integer("pro_benchmark_seconds").notNull(),
    averageSeconds: integer("average_seconds").notNull(),
    slowSeconds: integer("slow_seconds").notNull(),
    source: text("source"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("reference_times_unique").on(table.divisionId, table.station)]
);

// ============================================
// HYROX: Public Data (scraped race results)
// ============================================

export const hyroxPublicEvents = pgTable(
  "hyrox_public_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    externalId: text("external_id").unique().notNull(),
    name: text("name").notNull(),
    city: text("city").notNull(),
    country: text("country").notNull(),
    region: text("region").notNull(),
    eventDate: date("event_date").notNull(),
    season: text("season").notNull(),
    sourceUrl: text("source_url"),
    scrapedAt: timestamp("scraped_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_hyrox_public_events_date").on(table.eventDate),
    index("idx_hyrox_public_events_country_date").on(table.country, table.eventDate),
  ]
);

export const hyroxPublicResults = pgTable(
  "hyrox_public_results",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id").notNull().references(() => hyroxPublicEvents.id, { onDelete: "cascade" }),
    externalResultId: text("external_result_id").notNull(),
    externalAthleteHash: text("external_athlete_hash").notNull(),
    divisionKey: text("division_key").notNull(),
    ageGroup: text("age_group"),
    finishTimeSeconds: integer("finish_time_seconds").notNull(),
    overallRank: integer("overall_rank").notNull(),
    divisionRank: integer("division_rank").notNull(),
    fieldSizeDivision: integer("field_size_division").notNull(),
    percentile: numeric("percentile", { precision: 5, scale: 2 }).notNull(),
    isDnf: boolean("is_dnf").notNull().default(false),
    athleteNamesNormalized: text("athlete_names_normalized").array().notNull().default([]),
    rawScrapedNames: text("raw_scraped_names").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("hyrox_public_results_event_ext").on(table.eventId, table.externalResultId),
    index("idx_hyrox_public_results_division_event").on(table.divisionKey, table.eventId),
    index("idx_hyrox_public_results_division_time").on(table.divisionKey, table.finishTimeSeconds),
    index("idx_hyrox_public_results_athlete").on(table.externalAthleteHash),
    index("idx_hyrox_public_results_names_gin").using("gin", table.athleteNamesNormalized),
  ]
);

export const hyroxPublicSplits = pgTable(
  "hyrox_public_splits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    resultId: uuid("result_id").notNull().references(() => hyroxPublicResults.id, { onDelete: "cascade" }),
    segmentOrder: integer("segment_order").notNull(),
    segmentType: text("segment_type").notNull(),
    segmentLabel: text("segment_label").notNull(),
    stationName: text("station_name"),
    runNumber: integer("run_number"),
    timeSeconds: integer("time_seconds").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("hyrox_public_splits_result_order").on(table.resultId, table.segmentOrder),
    index("idx_hyrox_public_splits_result").on(table.resultId),
    index("idx_hyrox_public_splits_station").on(table.segmentType, table.stationName),
    index("idx_hyrox_public_splits_run").on(table.segmentType, table.runNumber),
  ]
);

// Materialized view `hyrox_public_division_aggregates` is defined in the SQL migration.
// Query it with db.execute(sql`SELECT ... FROM hyrox_public_division_aggregates ...`).

export const userPublicRaceClaims = pgTable(
  "user_public_race_claims",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    publicResultId: uuid("public_result_id").notNull().references(() => hyroxPublicResults.id, { onDelete: "cascade" }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).defaultNow().notNull(),
    disclaimerAckedAt: timestamp("disclaimer_acked_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("user_public_race_claims_user_result_unique").on(table.userId, table.publicResultId),
    index("idx_user_public_race_claims_user").on(table.userId),
    index("idx_user_public_race_claims_result").on(table.publicResultId),
  ]
);

// ============================================
// HYROX: Predictor Models & User Predictions
// ============================================

export const hyroxPredictorModels = pgTable(
  "hyrox_predictor_models",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    divisionKey: text("division_key").notNull(),
    modelType: text("model_type").notNull(),
    trainedAt: timestamp("trained_at", { withTimezone: true }).defaultNow().notNull(),
    trainingN: integer("training_n").notNull(),
    metrics: jsonb("metrics").notNull().default({}),
    featureImportances: jsonb("feature_importances").notNull().default([]),
    artifactUrl: text("artifact_url").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_hyrox_predictor_models_active").on(table.divisionKey, table.modelType),
  ]
);

export const hyroxUserPredictions = pgTable("hyrox_user_predictions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").unique().notNull().references(() => users.id, { onDelete: "cascade" }),
  divisionKey: text("division_key").notNull(),
  predictedFinishSeconds: integer("predicted_finish_seconds").notNull(),
  predictedFinishLow: integer("predicted_finish_low").notNull(),
  predictedFinishHigh: integer("predicted_finish_high").notNull(),
  predictedPercentile: numeric("predicted_percentile", { precision: 5, scale: 2 }).notNull(),
  confidence: numeric("confidence", { precision: 3, scale: 2 }).notNull(),
  contributingSignals: jsonb("contributing_signals").notNull().default({}),
  bottleneckStation: text("bottleneck_station"),
  bottleneckSavingsSeconds: integer("bottleneck_savings_seconds"),
  modelVersion: text("model_version"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ============================================
// HYROX: Entitlements (RevenueCat mirror)
// ============================================

export const hyroxEntitlements = pgTable(
  "hyrox_entitlements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    entitlementKey: text("entitlement_key").notNull(), // 'hyrox_personalized_plan'
    active: boolean("active").default(false).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    productId: text("product_id"),
    periodType: text("period_type"), // 'normal' | 'trial' | 'intro'
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("hyrox_entitlements_user_key").on(table.userId, table.entitlementKey),
    index("idx_hyrox_entitlements_user_active").on(table.userId, table.active),
  ]
);

// ============================================
// HYROX: Plan Credits (pay-per-plan + VIP allowance)
// ============================================

export const hyroxVipGrants = pgTable(
  "hyrox_vip_grants",
  {
    userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
    plansPerYear: integer("plans_per_year").notNull(),
    active: boolean("active").default(true).notNull(),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
);

export const hyroxPlanPurchases = pgTable(
  "hyrox_plan_purchases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    rcEventId: text("rc_event_id").unique().notNull(),
    rcTransactionId: text("rc_transaction_id"),
    productId: text("product_id"),
    amountCents: integer("amount_cents"),
    currency: text("currency"),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("idx_hyrox_plan_purchases_user").on(table.userId, table.purchasedAt)]
);

export const hyroxPlanGenerations = pgTable(
  "hyrox_plan_generations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    planId: uuid("plan_id").references(() => hyroxTrainingPlans.id, { onDelete: "set null" }),
    source: text("source").notNull(), // 'vip' | 'purchase' | 'bypass'
    // Unique so a purchase row can be consumed by at most one generation.
    purchaseId: uuid("purchase_id").unique().references(() => hyroxPlanPurchases.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("idx_hyrox_plan_generations_user_created").on(table.userId, table.createdAt)]
);

// ============================================
// HYROX: Practice Race Timer
// ============================================

export const hyroxPracticeRaces = pgTable(
  "hyrox_practice_races",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: text("title"),
    divisionKey: text("division_key"),
    template: text("template").notNull().default("full"),
    totalTimeSeconds: numeric("total_time_seconds", { precision: 10, scale: 1 }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    notes: text("notes"),
    raceType: text("race_type").notNull().default("practice"), // 'practice' | 'actual'
    planSessionId: uuid("plan_session_id").references(() => hyroxPlanSessions.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("practice_races_user").on(table.userId),
    index("practice_races_plan_session").on(table.planSessionId),
  ],
);

export const hyroxPracticeRaceSplits = pgTable(
  "hyrox_practice_race_splits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    raceId: uuid("race_id").notNull().references(() => hyroxPracticeRaces.id, { onDelete: "cascade" }),
    segmentOrder: integer("segment_order").notNull(),
    segmentType: text("segment_type").notNull(),
    segmentLabel: text("segment_label").notNull(),
    distanceMeters: integer("distance_meters"),
    reps: integer("reps"),
    timeSeconds: numeric("time_seconds", { precision: 10, scale: 1 }).notNull(),
  },
  (table) => [
    uniqueIndex("practice_splits_unique").on(table.raceId, table.segmentOrder),
    index("practice_splits_race").on(table.raceId),
  ],
);

// ============================================
// HYROX: AI Race Reports
// ============================================

export const hyroxRaceReports = pgTable(
  "hyrox_race_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    raceId: uuid("race_id")
      .notNull()
      .unique()
      .references(() => hyroxPracticeRaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"), // 'pending' | 'generating' | 'completed' | 'failed'

    headline: text("headline"),
    pacingAnalysis: text("pacing_analysis"),
    timeLossRanking: jsonb("time_loss_ranking").$type<TimeLossEntry[]>(),
    prioritizedFocus: jsonb("prioritized_focus").$type<FocusEntry[]>(),
    projectedFinishSeconds: integer("projected_finish_seconds"),
    projectedFinishAssumptions: text("projected_finish_assumptions"),

    aiModel: text("ai_model"),
    generationStartedAt: timestamp("generation_started_at", { withTimezone: true }),
    generationCompletedAt: timestamp("generation_completed_at", { withTimezone: true }),
    generationError: text("generation_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("race_reports_user").on(table.userId)],
);
