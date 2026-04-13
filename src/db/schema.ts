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

export const movements = pgTable("movements", {
  id: uuid("id").defaultRandom().primaryKey(),
  canonicalName: text("canonical_name").unique().notNull(),
  category: text("category").notNull(), // barbell | dumbbell | kettlebell | gymnastics | bodyweight | monostructural | accessory | other
  isWeighted: boolean("is_weighted").default(false).notNull(),
  is1rmApplicable: boolean("is_1rm_applicable").default(false).notNull(),
  commonRxWeightMale: numeric("common_rx_weight_male"),
  commonRxWeightFemale: numeric("common_rx_weight_female"),
  videoUrl: text("video_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

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
  workoutDate: date("workout_date").notNull(),
  published: boolean("published").default(false).notNull(),
  source: text("source").default("manual").notNull(), // 'manual' | 'parsed' | 'import' | 'benchmark'
  benchmarkWorkoutId: uuid("benchmark_workout_id").references(() => benchmarkWorkouts.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const workoutMovements = pgTable("workout_movements", {
  id: uuid("id").defaultRandom().primaryKey(),
  workoutId: uuid("workout_id").notNull().references(() => workouts.id, { onDelete: "cascade" }),
  movementId: uuid("movement_id").notNull().references(() => movements.id),
  orderIndex: integer("order_index").notNull(),
  prescribedReps: text("prescribed_reps"),
  prescribedWeightMale: numeric("prescribed_weight_male"),
  prescribedWeightFemale: numeric("prescribed_weight_female"),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("scores_workout_user").on(table.workoutId, table.userId)]
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
  setWeights: jsonb("set_weights"), // for_load: per-set weights
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
  timeCapSeconds: integer("time_cap_seconds"),
  amrapDurationSeconds: integer("amrap_duration_seconds"),
  repScheme: text("rep_scheme"),
  createdBy: uuid("created_by").references(() => users.id),
  communityId: uuid("community_id").references(() => communities.id),
  isSystem: boolean("is_system").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const benchmarkWorkoutMovements = pgTable("benchmark_workout_movements", {
  id: uuid("id").defaultRandom().primaryKey(),
  benchmarkWorkoutId: uuid("benchmark_workout_id").notNull().references(() => benchmarkWorkouts.id, { onDelete: "cascade" }),
  movementId: uuid("movement_id").notNull().references(() => movements.id),
  orderIndex: integer("order_index").notNull(),
  prescribedReps: text("prescribed_reps"),
  prescribedWeightMale: numeric("prescribed_weight_male"),
  prescribedWeightFemale: numeric("prescribed_weight_female"),
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
    actualTimeSeconds: integer("actual_time_seconds"),
    actualReps: integer("actual_reps"),
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
  },
  (table) => [index("benchmarks_user_station").on(table.userId, table.station, table.loggedAt)]
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
