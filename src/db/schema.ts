import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  smallint,
  numeric,
  doublePrecision,
  date,
  jsonb,
  uniqueIndex,
  index,
  foreignKey,
  primaryKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { TimeLossEntry, FocusEntry } from "@/types/hyrox-race-report";
import type {
  SetEntry,
  NotesComplaint,
  NotesScalingReason,
  NotesMilestone,
  NotesPerformanceSignal,
} from "@/types/crossfit";

// ============================================
// Users & Auth
// ============================================

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").unique().notNull(),
  name: text("name").notNull(),
  // Optional public handle for @mentions. Case-insensitive unique index in
  // SQL (see migration 20260512140500). Null until user opts in.
  username: text("username"),
  gender: text("gender"), // 'male' | 'female' | 'other'
  unitPreference: text("unit_preference").default("mixed").notNull(), // 'metric' | 'mixed'
  image: text("image"),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  isAdmin: boolean("is_admin").default(false).notNull(),
  isVip: boolean("is_vip").default(false).notNull(),
  // Canonical store: lb. Drives BW-multiplier Rx resolution.
  bodyWeightLb: numeric("body_weight_lb"),
  // Cross-device "active gym" pointer. Mirrored in localStorage so the
  // header dropdown renders synchronously on first paint. Null = personal
  // mode (no gym selected). FK declared in the SQL migration (not here)
  // to avoid a circular type dependency between `users` and `communities`.
  activeCommunityId: uuid("active_community_id"),
  // CrossFit page view choice: 'gym' (gym programming) or 'personal'. Null
  // means no explicit choice yet — the client defaults to 'gym'. Persisted
  // here so the preference survives app reinstalls and syncs across devices.
  crossfitView: text("crossfit_view"),
  // PR 3 §3.1 — extended profile fields. All optional. `dateOfBirth`
  // unlocks the birthday auto-post path (§3.8) once populated.
  dateOfBirth: date("date_of_birth"),
  phone: text("phone"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
  country: text("country"),
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactPhone: text("emergency_contact_phone"),
  emergencyContactRelation: text("emergency_contact_relation"),
  // Calorie estimation preferences. `epoc_enabled` is tri-state: null means
  // inherit the active community's default, true/false overrides it. Solo
  // users default to enabled at the community's default multiplier (1.10).
  epocEnabled: boolean("epoc_enabled"),
  pushToAppleHealth: boolean("push_to_apple_health").default(true).notNull(),
  // Dependents (spec §3.3). Account-holder–controlled profiles with no
  // auth user behind them. Filtered out of every social/leaderboard
  // surface — see src/lib/family.ts and the audit list in the spec §3.6.
  isShadow: boolean("is_shadow").default(false).notNull(),
  shadowCreatedByUserId: uuid("shadow_created_by_user_id"),
  shadowCreatedAt: timestamp("shadow_created_at", { withTimezone: true }),
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
  // Per-gym branding. Drives the in-app theme color, the gym header
  // logo, and the /g/<slug> invite landing. Unique slugs are enforced
  // at the SQL level (partial index) — see migration 20260518100100.
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color"),
  brandAssets: jsonb("brand_assets"),
  websiteUrl: text("website_url"),
  inviteUrlSlug: text("invite_url_slug"),
  autoJoinViaLink: boolean("auto_join_via_link").default(false).notNull(),
  // IANA tz string — used by every gym-local scheduled job (notifications,
  // end-of-month rollups, etc.). Default is CFD's timezone.
  gymTimezone: text("gym_timezone").default("America/Denver").notNull(),
  // Committed Club threshold (spec §2.5). Number of attended classes a
  // member needs in a month to qualify. Per-gym configurable; default 15.
  committedClubThreshold: integer("committed_club_threshold").default(15).notNull(),
  // PR 3 §3.5 — destination for "Ask the gym owner" support form.
  // Falls back to admin user emails when null.
  adminEmail: text("admin_email"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const communityMemberships = pgTable(
  "community_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    communityId: uuid("community_id").notNull().references(() => communities.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    // Per-gym role flags. A user can be both an admin and a coach (typical
    // affiliate owner / head coach). Members have neither flag.
    isAdmin: boolean("is_admin").default(false).notNull(),
    isCoach: boolean("is_coach").default(false).notNull(),
    // Gym admins can deactivate a member without deleting their score
    // history. Inactive members can't see the gym's programming.
    isActive: boolean("is_active").default(true).notNull(),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
    // Source for the anniversary auto-post job (spec §2.3). Defaults to
    // joined_at::date in the migration; member/admin can override later.
    gymAnniversaryDate: date("gym_anniversary_date"),
    // Who pays for this seat (dependents spec §3.2). For self-pay
    // adults, accountId = userId. For dependents, accountId points to
    // the account holder. Invariant enforced in the app layer (see
    // src/lib/family.ts `assertAccountConsistency`).
    accountId: uuid("account_id").notNull(),
  },
  (table) => [uniqueIndex("community_memberships_unique").on(table.communityId, table.userId)]
);

// ============================================
// Family memberships (dependents)
// ============================================
//
// Spec: claude_code_instructions/cfd_readiness/dependents_spec.md §3.1.
// A `familyMembers` row is the administrative tie between an account
// holder and a dependent inside a single gym. v1: one account holder
// per dependent per gym (no joint custody).
//
// Activation tokens (single-use, 14-day expiry) live on this row so
// the account holder can invite a shadow dependent to sign in.

export const familyMembers = pgTable(
  "family_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    communityId: uuid("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    // Restrict on delete: dependents must be re-parented or
    // cascade-deleted explicitly. SQL constraint is "restrict" — see
    // migration 20260520120000.
    accountHolderUserId: uuid("account_holder_user_id")
      .notNull()
      .references(() => users.id),
    dependentUserId: uuid("dependent_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // 'spouse' | 'partner' | 'child' | 'parent' | 'sibling' | 'other'
    relationship: text("relationship").notNull(),
    // Denormalized mirror of users.isShadow = false. Kept in sync by
    // the activation flow (spec §3.3).
    hasOwnLogin: boolean("has_own_login").default(false).notNull(),
    activationToken: text("activation_token").unique(),
    activationTokenSentAt: timestamp("activation_token_sent_at", {
      withTimezone: true,
    }),
    activationTokenExpiresAt: timestamp("activation_token_expires_at", {
      withTimezone: true,
    }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("family_members_community_dependent_unique").on(
      table.communityId,
      table.dependentUserId
    ),
    uniqueIndex("family_members_community_pair_unique").on(
      table.communityId,
      table.accountHolderUserId,
      table.dependentUserId
    ),
    index("family_members_account_holder_idx").on(
      table.accountHolderUserId,
      table.communityId
    ),
    index("family_members_dependent_idx").on(
      table.dependentUserId,
      table.communityId
    ),
  ]
);

// Pending consent invites for the "existing user as dependent" branch
// (spec §3.3 step 4 + §4.6). Only on accept does a `familyMembers`
// row get created.
export const familyInvites = pgTable(
  "family_invites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    communityId: uuid("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    accountHolderUserId: uuid("account_holder_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    inviteeUserId: uuid("invitee_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    relationship: text("relationship").notNull(),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    // 'accepted' | 'declined' | null (pending)
    response: text("response"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("family_invites_invitee_idx").on(table.inviteeUserId),
    index("family_invites_account_holder_idx").on(
      table.accountHolderUserId,
      table.communityId
    ),
  ]
);

export type FamilyMember = typeof familyMembers.$inferSelect;
export type NewFamilyMember = typeof familyMembers.$inferInsert;
export type FamilyInvite = typeof familyInvites.$inferSelect;
export type NewFamilyInvite = typeof familyInvites.$inferInsert;

export const FAMILY_RELATIONSHIPS = [
  "spouse",
  "partner",
  "child",
  "parent",
  "sibling",
  "other",
] as const;
export type FamilyRelationship = (typeof FAMILY_RELATIONSHIPS)[number];

// ============================================
// Feature flags
// ============================================

// Registry of all known flags. Seeded by the migration so the admin UI
// always has a canonical list of toggles to render.
export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  description: text("description"),
  defaultValue: jsonb("default_value").notNull(),
  isPerGym: boolean("is_per_gym").default(false).notNull(),
  isPerUser: boolean("is_per_user").default(false).notNull(),
  // When true, an active gym admin/coach can toggle this flag for their own
  // gym from the limited /admin/feature-flags view. When false, only super
  // admins can change it.
  isGymAdminConfigurable: boolean("is_gym_admin_configurable")
    .default(false)
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Per-gym overrides. A row here means "for this gym, this flag is set to
// `value` regardless of the registry default."
export const communityFeatureOverrides = pgTable(
  "community_feature_overrides",
  {
    communityId: uuid("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    flagKey: text("flag_key")
      .notNull()
      .references(() => featureFlags.key, { onDelete: "cascade" }),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.communityId, table.flagKey] }),
  })
);

// Per-user overrides. Used for developer/early-access flags that gate on
// a single user rather than a gym (e.g. the legacy `move_to_gym` tool).
export const userFeatureOverrides = pgTable(
  "user_feature_overrides",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    flagKey: text("flag_key")
      .notNull()
      .references(() => featureFlags.key, { onDelete: "cascade" }),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.flagKey] }),
  })
);

export type FeatureFlag = typeof featureFlags.$inferSelect;
export type NewFeatureFlag = typeof featureFlags.$inferInsert;
export type CommunityFeatureOverride = typeof communityFeatureOverrides.$inferSelect;
export type UserFeatureOverride = typeof userFeatureOverrides.$inferSelect;

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
    // Calorie-estimation fields (see crossfit_calorie_estimation_spec.md). Base
    // MET at typical intensity; the estimator applies an intensity modifier at
    // compute time. `is_paced_run` / `is_paced_erg` mean "look me up by pace,
    // ignore met_value".
    metValue: numeric("met_value"),
    metCompendiumCode: text("met_compendium_code"),
    metIsEstimated: boolean("met_is_estimated").default(false).notNull(),
    metSource: text("met_source").default("2024 Adult Compendium"),
    metNotes: text("met_notes"),
    repSecondsDefault: numeric("rep_seconds_default"),
    isPacedRun: boolean("is_paced_run").default(false).notNull(),
    isPacedErg: text("is_paced_erg"), // 'row' | 'ski' | null
    metUpdatedAt: timestamp("met_updated_at", { withTimezone: true }),
    // Stimulus class the catalog Rx weight is calibrated for. Lets the
    // suggested-weight engine scale Rx baselines up/down when the actual
    // workout's stimulus differs. Admin-curated. See
    // suggested_working_weight_and_template_history_spec.md.
    rxStimulusClass: text("rx_stimulus_class"),
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
  // When a workout was generated from a programming release (spec §1.6),
  // this points back to the release so re-publishing can re-find it.
  // FK declared in the SQL migration (not here) to avoid a circular type
  // dependency between `workouts` and `programmingReleases`.
  programmingReleaseId: uuid("programming_release_id"),
  // When the coach last saved changes to this workout (CAP-import overwrite
  // guard).
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  // Template-level calorie estimate computed against a 75 kg reference
  // athlete. Per-athlete numbers live on `scores`.
  estimatedKcalLow: integer("estimated_kcal_low"),
  estimatedKcalHigh: integer("estimated_kcal_high"),
  estimatedKcalMethod: text("estimated_kcal_method"),
  estimatedKcalConfidence: text("estimated_kcal_confidence"),
  estimatedKcalComputedAt: timestamp("estimated_kcal_computed_at", {
    withTimezone: true,
  }),
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
    // For for_load parts, doubles as the prescribed set count ("5 sets of…").
    rounds: integer("rounds"),
    // Structural pattern modifier for the part, null otherwise. 'tabata' on a
    // for_reps part declares a Tabata cadence; 'complex' on a for_load part
    // marks an unbroken barbell complex. Avoids minting a new workout_type.
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
    // Timed Rounds — aggregation strategy ('slowest' | 'fastest' | 'sum' |
    // 'average') and optional per-round window in seconds. Required at the
    // Zod layer when workout_type = 'timed_rounds'; nullable here so other
    // workout types don't need backfill.
    roundScoreAggregation: text("round_score_aggregation"),
    roundWindowSeconds: integer("round_window_seconds"),
    notes: text("notes"),
    // Group this part under a typed section (spec §1.6). Null = no section
    // (personal workouts and any pre-PR1 gym workout). FK declared in the
    // SQL migration to keep the circular type dependency at the schema
    // level instead of the TS level.
    workoutSectionId: uuid("workout_section_id"),
    // Per-part calorie estimate at 75 kg reference. Workout-level totals are
    // the sum of these. Storing per-part means a mixed strength+metcon workout
    // gets the right `workoutType`-specific math on each section.
    estimatedKcalLow: integer("estimated_kcal_low"),
    estimatedKcalHigh: integer("estimated_kcal_high"),
    estimatedKcalConfidence: text("estimated_kcal_confidence"),
    scoreType: text("score_type"),
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
  // weight_pct Rx — prescribe this movement as a percentage of the max load
  // logged on an earlier for_load part. `prescribedWeightPct` is the
  // percentage (e.g. 60); `prescribedWeightPctSourcePartId` points at that
  // earlier part. Resolved to a concrete working weight at score-entry time.
  // Non-gendered: it's a % of the athlete's own max either way.
  prescribedWeightPct: numeric("prescribed_weight_pct"),
  prescribedWeightPctSourcePartId: uuid(
    "prescribed_weight_pct_source_part_id"
  ).references(() => workoutParts.id, { onDelete: "set null" }),
  // Free-text tempo prescription, e.g. "30X1".
  tempo: text("tempo"),
  // When true the movement is the score-bearing movement of its part:
  // the athlete logs per-round rep counts during score entry, and we sum
  // them into totalReps. Mutually exclusive with prescribedReps at the
  // UI layer.
  isMaxReps: boolean("is_max_reps").default(false).notNull(),
  // When true the movement's score is the duration of each round (e.g.
  // "Run 400m × 3 as fast as possible"): the athlete logs one duration
  // per round at score entry, and the total time across rounds becomes
  // the part's score. Mutually exclusive with isMaxReps at the UI layer.
  captureDurationPerRound: boolean("capture_duration_per_round")
    .default(false)
    .notNull(),
  // When true, this movement is the side-cadence movement (performed at
  // the part's cadence) rather than part of the main task. See workout_parts.
  isSideCadence: boolean("is_side_cadence").default(false).notNull(),
  repSchemeParsed: jsonb("rep_scheme_parsed"), // RepSchemeParsed | null — see lib/crossfit/rep-scheme-parser.ts
  equipmentCount: integer("equipment_count"),
  rxStandard: text("rx_standard"),
  notes: text("notes"),
  weightSource: text("weight_source").default("prescribed").notNull(),
});

// ============================================
// CrossFit: Scores
// ============================================

export const scores = pgTable(
  "scores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Legacy FK columns. New writes (post write-cutover) leave these null
    // and populate `workoutSessionId` / `crossfitWorkoutPartId` instead.
    // The drop migration retires these once every reader is on the
    // unified schema.
    workoutId: uuid("workout_id").references(() => workouts.id, { onDelete: "cascade" }),
    workoutPartId: uuid("workout_part_id").references(() => workoutParts.id, { onDelete: "cascade" }),
    // Unified-schema FKs. The write cutover populates these; the legacy
    // columns above stay null on new rows.
    workoutSessionId: uuid("workout_session_id"),
    crossfitWorkoutPartId: uuid("crossfit_workout_part_id"),
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
    rpe: doublePrecision("rpe"), // 1-10, 0.5 increments (auto-averaged from per-set RPE when filled)
    // Vest the athlete actually wore (only meaningful when the workout
    // requires a vest). Lets a Murph-without-vest score show a badge
    // without flipping the division to scaled.
    woreVest: boolean("wore_vest"),
    vestWeightLb: numeric("vest_weight_lb"),
    // Denormalized aggregates kept in sync by transactional bumps in the
    // reaction / comment write paths; a nightly cron reconciles drift.
    reactionCount: integer("reaction_count").default(0).notNull(),
    commentCount: integer("comment_count").default(0).notNull(),
    // Session bracket — populated by the live logger when available, else
    // derived from the score's own time fields at save time. Used both as the
    // duration source for the calorie estimator and as the timestamp we push
    // to Apple Health so retroactively-logged scores land at the right time.
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationSeconds: integer("duration_seconds"),
    // Bodyweight snapshot at the moment the score was logged. Canonical lb;
    // the estimator converts to kg internally. Never retroactively recomputed.
    bodyweightLbAtScore: numeric("bodyweight_lb_at_score"),
    // Calorie outputs. We pre-compute all four flavors at save time so the
    // EPOC toggle and the active/total switch are display-time flips with no
    // recompute. `_active` strips the BMR baseline and is what we push to
    // Apple Health so the Move ring doesn't double-count resting energy.
    estimatedKcal: integer("estimated_kcal"),
    estimatedKcalActive: integer("estimated_kcal_active"),
    estimatedKcalWithEpoc: integer("estimated_kcal_with_epoc"),
    estimatedKcalActiveWithEpoc: integer("estimated_kcal_active_with_epoc"),
    estimatedKcalMethod: text("estimated_kcal_method"),
    estimatedKcalConfidence: text("estimated_kcal_confidence"),
    // 'model' | 'apple_health_user' | 'manual_override'. The kcal value itself
    // is not user-editable — only this flag is.
    estimatedKcalSource: text("estimated_kcal_source").default("model").notNull(),
    appleHealthWorkoutUuid: uuid("apple_health_workout_uuid"),
    // Per-round durations for a timed_rounds part. Length should equal the
    // part's `rounds`. The aggregated value (slowest / fastest / sum /
    // average) is stored in `timeSeconds` so the existing ascending-time
    // sort works without any special-case math.
    roundDurationsSeconds: integer("round_durations_seconds").array(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Legacy per-`workout_parts` dedup. Partial in the DB (only fires when
    // workout_part_id is not null) — kept here for documentation; new
    // unified-schema writes leave workout_part_id null.
    uniqueIndex("scores_part_user_unique").on(table.workoutPartId, table.userId),
    // Unified-schema dedup: one score per (session, template-part, user).
    // Partial — only enforced when both unified FKs are populated.
    uniqueIndex("scores_session_part_user_unique").on(
      table.workoutSessionId,
      table.crossfitWorkoutPartId,
      table.userId
    ),
    index("scores_part_idx").on(table.workoutPartId),
  ]
);

// ============================================
// Calorie estimation — per-athlete cadence + per-gym EPOC
// ============================================

// Populated nightly by an Inngest job once a user has ≥3 logged scores of a
// given movement with derivable rep-time. The estimator prefers this over
// `movements.rep_seconds_default` when available.
export const userMovementPaces = pgTable(
  "user_movement_paces",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    movementId: uuid("movement_id")
      .notNull()
      .references(() => movements.id, { onDelete: "cascade" }),
    repSecondsObserved: numeric("rep_seconds_observed").notNull(),
    sampleSize: integer("sample_size").notNull(),
    lastComputedAt: timestamp("last_computed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.movementId] }),
    index("user_movement_paces_movement_idx").on(table.movementId),
  ]
);

export const communityCaloriePreferences = pgTable(
  "community_calorie_preferences",
  {
    communityId: uuid("community_id")
      .primaryKey()
      .references(() => communities.id, { onDelete: "cascade" }),
    epocDefaultEnabled: boolean("epoc_default_enabled").default(true).notNull(),
    // HIIT-default 1.10. Range 1.0–1.20 enforced in SQL.
    epocMultiplier: numeric("epoc_multiplier").default("1.10").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  }
);

export type UserMovementPace = typeof userMovementPaces.$inferSelect;
export type NewUserMovementPace = typeof userMovementPaces.$inferInsert;
export type CommunityCaloriePreferences =
  typeof communityCaloriePreferences.$inferSelect;
export type NewCommunityCaloriePreferences =
  typeof communityCaloriePreferences.$inferInsert;

// ============================================
// Suggested working weight — strength cache + stimulus profiles
// ============================================
//
// See claude_code_instructions/crossfit_improvements/
//     suggested_working_weight_and_template_history_spec.md.

// Stimulus-class → %1RM band, per movement category. Admin-editable. Seeded
// from the spec values; tunable later as we gather logged data.
export const stimulusProfiles = pgTable(
  "stimulus_profiles",
  {
    stimulusClass: text("stimulus_class").notNull(),
    movementCategory: text("movement_category").notNull(),
    pct1rmLow: numeric("pct_1rm_low").notNull(),
    pct1rmHigh: numeric("pct_1rm_high").notNull(),
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.stimulusClass, table.movementCategory] }),
  ]
);

// Per-(user, movement) best-known 1RM. Rebuilt on score save + nightly. The
// estimator prefers logged_1rm over rep-max estimates; among estimates,
// prefers the highest observed in the last 12 months.
export const athleteMovementStrength = pgTable(
  "athlete_movement_strength",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    movementId: uuid("movement_id")
      .notNull()
      .references(() => movements.id, { onDelete: "cascade" }),
    estimated1rmLb: numeric("estimated_1rm_lb").notNull(),
    source: text("source").notNull(),
    sourceScoreId: uuid("source_score_id").references(() => scores.id, {
      onDelete: "set null",
    }),
    sourceSetWeightLb: numeric("source_set_weight_lb"),
    sourceSetReps: integer("source_set_reps"),
    sampleSize: integer("sample_size").default(1).notNull(),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true })
      .notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.movementId] }),
    index("idx_ams_user").on(table.userId),
    index("idx_ams_movement").on(table.movementId),
  ]
);

export type StimulusProfile = typeof stimulusProfiles.$inferSelect;
export type NewStimulusProfile = typeof stimulusProfiles.$inferInsert;
export type AthleteMovementStrength =
  typeof athleteMovementStrength.$inferSelect;
export type NewAthleteMovementStrength =
  typeof athleteMovementStrength.$inferInsert;

// Stimulus classes — matches the CHECK constraint in the migration and the
// classifier output.
export const STIMULUS_CLASSES = [
  "strength_heavy",
  "strength_moderate",
  "short_intense",
  "moderate_metcon",
  "long_metcon",
  "oly_metcon",
] as const;
export type StimulusClass = (typeof STIMULUS_CLASSES)[number];

export const ATHLETE_MOVEMENT_STRENGTH_SOURCES = [
  "logged_1rm",
  "epley_from_set",
  "brzycki_from_set",
  "gym_default",
] as const;
export type AthleteMovementStrengthSource =
  (typeof ATHLETE_MOVEMENT_STRENGTH_SOURCES)[number];

export const SUGGESTED_WEIGHT_METHODS = [
  "logged_1rm",
  "estimated_1rm",
  "similar_template_history",
  "direct_template_history",
  "rx_fallback",
  "unavailable",
] as const;
export type SuggestedWeightMethod = (typeof SUGGESTED_WEIGHT_METHODS)[number];

export const scoreMovementDetails = pgTable("score_movement_details", {
  id: uuid("id").defaultRandom().primaryKey(),
  scoreId: uuid("score_id").notNull().references(() => scores.id, { onDelete: "cascade" }),
  // Legacy FK to workout_movements.id. New writes (post-cutover) leave this
  // null and populate `crossfitWorkoutMovementId` instead.
  workoutMovementId: uuid("workout_movement_id"),
  // Unified-schema FK to crossfit_workout_movements.id.
  crossfitWorkoutMovementId: uuid("crossfit_workout_movement_id").references(
    () => crossfitWorkoutMovements.id,
    { onDelete: "cascade" }
  ),
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
  // Per-round duration in seconds for captureDurationPerRound movements
  // (e.g. "Run 400m × 3 as fast as possible"). Length matches part.rounds.
  actualDurationSecondsPerRound: integer(
    "actual_duration_seconds_per_round"
  ).array(),
  // Per-round captured weight (lb) for athlete-picked-weight movements
  // (weight_source = 'athlete'). Length matches part.rounds; empty slots
  // round-trip as 0. numeric (not integer) preserves half-pound values from
  // kg->lb conversions.
  actualWeightLbsPerRound: numeric("actual_weight_lbs_per_round").array(),
  notes: text("notes"),
  // Suggested-weight snapshot (display + analytics only — never overrides
  // the athlete's actual logged weight). Captured at score-save time so we
  // can later study how often the suggestion matched what they used.
  suggestedWeightLbLow: numeric("suggested_weight_lb_low"),
  suggestedWeightLbHigh: numeric("suggested_weight_lb_high"),
  suggestedWeightConfidence: text("suggested_weight_confidence"),
  suggestedWeightMethod: text("suggested_weight_method"),
}, (table) => [
  foreignKey({
    name: "smd_workout_movement_id_fk",
    columns: [table.workoutMovementId],
    foreignColumns: [workoutMovements.id],
  }).onDelete("cascade"),
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
  // When non-null, this row is an auto-generated weightlifting benchmark
  // anchored to the named movement. The "1RM / 2RM / 3RM / 5RM" tabs in the
  // detail UI are derived at query time from the athlete's for_load history
  // against this movement — there is no per-rep-max row.
  weightliftingMovementId: uuid("weightlifting_movement_id").references(
    () => movements.id,
    { onDelete: "cascade" }
  ),
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
  performanceSignals: jsonb("performance_signals")
    .$type<NotesPerformanceSignal[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  extractedAt: timestamp("extracted_at", { withTimezone: true }).defaultNow().notNull(),
  modelVersion: text("model_version").notNull(),
  contentHash: text("content_hash"),
});

// Denormalized mirror of `scoreNotesExtractions.performanceSignals` —
// one row per (score, performance signal). Populated by the extraction
// worker in the same transaction that writes `scoreNotesExtractions`, so
// the JSONB column and this table stay in lockstep without a backfill
// job. Powers the workout-detail prep card lookup ("give me this user's
// best signals for movement X in the last 90 days") cheaply.
// See claude_code_instructions/crossfit_improvements/notes_insights_v2_spec.md §3.2.
export const scoreMovementSignals = pgTable(
  "score_movement_signals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scoreId: uuid("score_id")
      .notNull()
      .references(() => scores.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Canonical-ish movement string emitted by the LLM. Deliberately not
    // an FK to movements.id — the prep card resolves to a catalog row at
    // read time via case-insensitive canonical_name match.
    movementName: text("movement_name").notNull(),
    metric: text("metric").notNull(),
    value: numeric("value").notNull(),
    unit: text("unit").notNull(),
    // SQL column is `metric_window` because `window` is a reserved word in
    // PostgreSQL. The TS shape exposes it as `window` so callers see the
    // same key as the LLM emits.
    window: text("metric_window"),
    qualitative: text("qualitative"),
    phrase: text("phrase").notNull(),
    workoutDate: date("workout_date").notNull(),
    extractedAt: timestamp("extracted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("score_movement_signals_user_movement_date_idx").on(
      table.userId,
      sql`lower(${table.movementName})`,
      sql`${table.workoutDate} desc`
    ),
    index("score_movement_signals_score_id_idx").on(table.scoreId),
  ]
);

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
    scoreType: text("score_type"),
    // Timed Rounds — see workoutParts for documentation.
    roundScoreAggregation: text("round_score_aggregation"),
    roundWindowSeconds: integer("round_window_seconds"),
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
  captureDurationPerRound: boolean("capture_duration_per_round")
    .default(false)
    .notNull(),
  isSideCadence: boolean("is_side_cadence").default(false).notNull(),
  repSchemeParsed: jsonb("rep_scheme_parsed"),
  equipmentCount: integer("equipment_count"),
  rxStandard: text("rx_standard"),
  notes: text("notes"),
  weightSource: text("weight_source").default("prescribed").notNull(),
});

// ============================================
// CrossFit: Unified workout templates (NEW)
// ============================================
//
// `crossfit_workouts` is the canonical template — one row per distinct
// workout prescription. `workout_sessions` is the per-(date, athlete | gym,
// position) instance. Templates are deduplicated by content_fingerprint
// within scope.
//
// See claude_code_instructions/crossfit_improvements/unified_crossfit_workout_template_spec.md.

export const crossfitWorkouts = pgTable(
  "crossfit_workouts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category"),
    isBenchmark: boolean("is_benchmark").default(false).notNull(),
    isSystem: boolean("is_system").default(false).notNull(),
    weightliftingMovementId: uuid("weightlifting_movement_id").references(
      () => movements.id,
      { onDelete: "cascade" }
    ),
    // Scope. System templates have both null; non-system have exactly one set.
    createdBy: uuid("created_by").references(() => users.id),
    communityId: uuid("community_id").references(() => communities.id, {
      onDelete: "cascade",
    }),
    contentFingerprint: text("content_fingerprint").notNull(),
    // Self-FK declared in SQL to avoid Drizzle type-cycle issues.
    forkedFromCrossfitWorkoutId: uuid("forked_from_crossfit_workout_id"),
    workoutType: text("workout_type").notNull(),
    timeCapSeconds: integer("time_cap_seconds"),
    amrapDurationSeconds: integer("amrap_duration_seconds"),
    repScheme: text("rep_scheme"),
    rounds: integer("rounds"),
    requiresVest: boolean("requires_vest").default(false).notNull(),
    vestWeightMaleLb: numeric("vest_weight_male_lb"),
    vestWeightFemaleLb: numeric("vest_weight_female_lb"),
    isPartner: boolean("is_partner").default(false).notNull(),
    partnerCount: integer("partner_count"),
    coachNotes: text("coach_notes"),
    estimatedKcalLow: integer("estimated_kcal_low"),
    estimatedKcalHigh: integer("estimated_kcal_high"),
    estimatedKcalMethod: text("estimated_kcal_method"),
    estimatedKcalConfidence: text("estimated_kcal_confidence"),
    estimatedKcalComputedAt: timestamp("estimated_kcal_computed_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("crossfit_workouts_user_fp_unique")
      .on(table.createdBy, table.contentFingerprint, table.isBenchmark)
      .where(sql`created_by is not null`),
    uniqueIndex("crossfit_workouts_community_fp_unique")
      .on(table.communityId, table.contentFingerprint, table.isBenchmark)
      .where(sql`community_id is not null`),
    index("crossfit_workouts_benchmark_idx")
      .on(table.isBenchmark)
      .where(sql`is_benchmark = true`),
    index("crossfit_workouts_community_idx")
      .on(table.communityId)
      .where(sql`community_id is not null`),
    index("crossfit_workouts_created_by_idx")
      .on(table.createdBy)
      .where(sql`created_by is not null`),
    index("crossfit_workouts_category_idx")
      .on(table.category)
      .where(sql`category is not null`),
    index("crossfit_workouts_weightlifting_movement_idx")
      .on(table.weightliftingMovementId)
      .where(sql`weightlifting_movement_id is not null`),
  ]
);

export const crossfitWorkoutParts = pgTable(
  "crossfit_workout_parts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    crossfitWorkoutId: uuid("crossfit_workout_id")
      .notNull()
      .references(() => crossfitWorkouts.id, { onDelete: "cascade" }),
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
    sideCadenceOpenEnded: boolean("side_cadence_open_ended")
      .default(false)
      .notNull(),
    // Timed Rounds — see workoutParts for documentation.
    roundScoreAggregation: text("round_score_aggregation"),
    roundWindowSeconds: integer("round_window_seconds"),
    notes: text("notes"),
    estimatedKcalLow: integer("estimated_kcal_low"),
    estimatedKcalHigh: integer("estimated_kcal_high"),
    estimatedKcalConfidence: text("estimated_kcal_confidence"),
    scoreType: text("score_type"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("crossfit_workout_parts_workout_order_unique").on(
      table.crossfitWorkoutId,
      table.orderIndex
    ),
    index("crossfit_workout_parts_workout_idx").on(table.crossfitWorkoutId),
  ]
);

export const crossfitWorkoutBlocks = pgTable(
  "crossfit_workout_blocks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    crossfitWorkoutPartId: uuid("crossfit_workout_part_id")
      .notNull()
      .references(() => crossfitWorkoutParts.id, { onDelete: "cascade" }),
    orderIndex: integer("order_index").notNull(),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("crossfit_workout_blocks_part_order_unique").on(
      table.crossfitWorkoutPartId,
      table.orderIndex
    ),
    index("crossfit_workout_blocks_part_idx").on(table.crossfitWorkoutPartId),
  ]
);

export const crossfitWorkoutMovements = pgTable(
  "crossfit_workout_movements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    crossfitWorkoutId: uuid("crossfit_workout_id")
      .notNull()
      .references(() => crossfitWorkouts.id, { onDelete: "cascade" }),
    crossfitWorkoutPartId: uuid("crossfit_workout_part_id")
      .notNull()
      .references(() => crossfitWorkoutParts.id, { onDelete: "cascade" }),
    crossfitWorkoutBlockId: uuid("crossfit_workout_block_id").references(
      () => crossfitWorkoutBlocks.id,
      { onDelete: "set null" }
    ),
    movementId: uuid("movement_id")
      .notNull()
      .references(() => movements.id),
    orderIndex: integer("order_index").notNull(),
    prescribedReps: text("prescribed_reps"),
    prescribedWeightMale: numeric("prescribed_weight_male"),
    prescribedWeightFemale: numeric("prescribed_weight_female"),
    prescribedCaloriesMale: text("prescribed_calories_male"),
    prescribedCaloriesFemale: text("prescribed_calories_female"),
    prescribedDistanceMale: text("prescribed_distance_male"),
    prescribedDistanceFemale: text("prescribed_distance_female"),
    prescribedDurationSecondsMale: integer("prescribed_duration_seconds_male"),
    prescribedDurationSecondsFemale: integer(
      "prescribed_duration_seconds_female"
    ),
    prescribedHeightInches: numeric("prescribed_height_inches"),
    prescribedHeightInchesMale: numeric("prescribed_height_inches_male"),
    prescribedHeightInchesFemale: numeric("prescribed_height_inches_female"),
    prescribedWeightMaleBwMultiplier: numeric(
      "prescribed_weight_male_bw_multiplier"
    ),
    prescribedWeightFemaleBwMultiplier: numeric(
      "prescribed_weight_female_bw_multiplier"
    ),
    prescribedWeightPct: numeric("prescribed_weight_pct"),
    prescribedWeightPctSourcePartId: uuid(
      "prescribed_weight_pct_source_part_id"
    ).references(() => crossfitWorkoutParts.id, { onDelete: "set null" }),
    tempo: text("tempo"),
    isMaxReps: boolean("is_max_reps").default(false).notNull(),
    captureDurationPerRound: boolean("capture_duration_per_round")
      .default(false)
      .notNull(),
    isSideCadence: boolean("is_side_cadence").default(false).notNull(),
    repSchemeParsed: jsonb("rep_scheme_parsed"),
    equipmentCount: integer("equipment_count"),
    rxStandard: text("rx_standard"),
    notes: text("notes"),
    weightSource: text("weight_source").default("prescribed").notNull(),
  },
  (table) => [
    index("crossfit_workout_movements_workout_idx").on(table.crossfitWorkoutId),
    index("crossfit_workout_movements_part_idx").on(table.crossfitWorkoutPartId),
    index("crossfit_workout_movements_movement_idx").on(table.movementId),
  ]
);

export const workoutSessions = pgTable(
  "workout_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    crossfitWorkoutId: uuid("crossfit_workout_id").references(
      () => crossfitWorkouts.id,
      { onDelete: "restrict" }
    ),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    communityId: uuid("community_id").references(() => communities.id, {
      onDelete: "cascade",
    }),
    workoutDate: date("workout_date").notNull(),
    kind: text("kind").default("wod").notNull(),
    subKind: text("sub_kind"),
    position: integer("position").default(0).notNull(),
    title: text("title"),
    body: text("body"),
    isScored: boolean("is_scored").default(false).notNull(),
    scoreType: text("score_type"),
    coachNotes: text("coach_notes"),
    source: text("source").default("manual").notNull(),
    // FK declared in SQL to avoid the circular type dep with programmingReleases.
    programmingReleaseId: uuid("programming_release_id"),
    sourceTrackId: uuid("source_track_id"),
    published: boolean("published").default(false).notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    estimatedKcalLow: integer("estimated_kcal_low"),
    estimatedKcalHigh: integer("estimated_kcal_high"),
    estimatedKcalConfidence: text("estimated_kcal_confidence"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("workout_sessions_user_date_idx")
      .on(table.userId, sql`workout_date desc`)
      .where(sql`user_id is not null`),
    index("workout_sessions_community_date_idx")
      .on(table.communityId, sql`workout_date desc`)
      .where(sql`community_id is not null`),
    index("workout_sessions_template_idx")
      .on(table.crossfitWorkoutId)
      .where(sql`crossfit_workout_id is not null`),
    index("workout_sessions_day_order_idx")
      .on(table.communityId, table.workoutDate, table.position)
      .where(sql`community_id is not null`),
    index("workout_sessions_programming_release_idx")
      .on(table.programmingReleaseId)
      .where(sql`programming_release_id is not null`),
    index("workout_sessions_source_track_idx")
      .on(table.sourceTrackId)
      .where(sql`source_track_id is not null`),
  ]
);

export type CrossfitWorkout = typeof crossfitWorkouts.$inferSelect;
export type NewCrossfitWorkout = typeof crossfitWorkouts.$inferInsert;
export type CrossfitWorkoutPart = typeof crossfitWorkoutParts.$inferSelect;
export type NewCrossfitWorkoutPart = typeof crossfitWorkoutParts.$inferInsert;
export type CrossfitWorkoutBlock = typeof crossfitWorkoutBlocks.$inferSelect;
export type NewCrossfitWorkoutBlock = typeof crossfitWorkoutBlocks.$inferInsert;
export type CrossfitWorkoutMovement =
  typeof crossfitWorkoutMovements.$inferSelect;
export type NewCrossfitWorkoutMovement =
  typeof crossfitWorkoutMovements.$inferInsert;
export type WorkoutSession = typeof workoutSessions.$inferSelect;
export type NewWorkoutSession = typeof workoutSessions.$inferInsert;

// Valid session kinds (mirrors the CHECK constraint in the migration).
export const WORKOUT_SESSION_KINDS = [
  "warm_up",
  "pre_skill",
  "wod",
  "post_skill",
  "stretching",
  "at_home",
  "monthly_challenge",
  "custom",
] as const;
export type WorkoutSessionKind = (typeof WORKOUT_SESSION_KINDS)[number];

// Kinds that hold freeform text rather than a template.
export const FREEFORM_SESSION_KINDS = ["warm_up", "stretching"] as const;
export type FreeformSessionKind = (typeof FREEFORM_SESSION_KINDS)[number];

export const WORKOUT_SESSION_KIND_LABELS: Record<WorkoutSessionKind, string> = {
  warm_up: "Warm-up",
  pre_skill: "Pre-skill",
  wod: "WOD",
  post_skill: "Post-skill",
  stretching: "Stretching",
  at_home: "At-home",
  monthly_challenge: "Monthly challenge",
  custom: "Custom",
};

export const WORKOUT_SESSION_SCORE_TYPES = [
  "time",
  "rounds",
  "reps",
  "weight",
  "no_score",
] as const;
export type WorkoutSessionScoreType =
  (typeof WORKOUT_SESSION_SCORE_TYPES)[number];

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
    distanceMeters: integer("distance_meters"),
    reps: integer("reps"),
    weightKg: numeric("weight_kg"),
    weightLabel: text("weight_label"),
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
    trainingEventIds: jsonb("training_event_ids").$type<string[] | null>(),
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
    // Client-supplied dedup key. Both the paired watch and phone share
    // the same UUID for a given race, so a duplicate POST from either
    // device is treated as an idempotent no-op (partial UNIQUE index
    // on user_id + client_race_id where NOT NULL).
    clientRaceId: text("client_race_id"),
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
    segmentSubtype: text("segment_subtype"),
    segmentLabel: text("segment_label").notNull(),
    distanceMeters: integer("distance_meters"),
    reps: integer("reps"),
    weightKg: numeric("weight_kg"),
    weightLabel: text("weight_label"),
    timeSeconds: numeric("time_seconds", { precision: 10, scale: 1 }).notNull(),
  },
  (table) => [
    uniqueIndex("practice_splits_unique").on(table.raceId, table.segmentOrder),
    index("practice_splits_race").on(table.raceId),
  ],
);

// ============================================
// HYROX: Saved Race Timer Templates
// ============================================

// Stored shape of a saved-template race segment. Mirrors the runtime
// RaceSegment type from src/components/hyrox/race-timer/types.ts, minus
// the volatile `id` (regenerated on load so React keys stay stable).
export interface RaceTemplateSegment {
  segmentType: "run" | "station";
  segmentSubtype?: "prescribed_run" | "roxzone" | null;
  label: string;
  distance?: string;
  distanceMeters?: number;
  reps?: number;
  weightKg?: number;
  weightLabel?: string;
}

export const hyroxRaceTemplates = pgTable(
  "hyrox_race_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    divisionKey: text("division_key"),
    simulateRoxzone: boolean("simulate_roxzone").notNull().default(false),
    // Pre-race countdown the template was saved with. NULL = use the
    // device's standing preference at race start. Allowed non-null
    // values: 0, 3, 5, 10 (enforced by a CHECK constraint in the
    // migration and by the picker UI).
    countdownSeconds: smallint("countdown_seconds"),
    segments: jsonb("segments").$type<RaceTemplateSegment[]>().notNull(),
    // When non-null, this template is shared with the given gym; every
    // active member of that community can see and clone it.
    communityId: uuid("community_id").references(() => communities.id, { onDelete: "set null" }),
    // For clones, points at the original gym-shared template the user
    // copied from. Survives deletion of the original (SET NULL).
    clonedFromId: uuid("cloned_from_id").references((): AnyPgColumn => hyroxRaceTemplates.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("race_templates_user").on(table.userId, table.createdAt)],
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
    // 'improvement' for canonical Full/Half races (current finish minus
    // top time-loss segments); 'extrapolation' for custom races
    // (full-HYROX estimate at the athlete's observed pace). NULL on
    // legacy rows pre-dating the column.
    projectionType: text("projection_type"),

    aiModel: text("ai_model"),
    generationStartedAt: timestamp("generation_started_at", { withTimezone: true }),
    generationCompletedAt: timestamp("generation_completed_at", { withTimezone: true }),
    generationError: text("generation_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("race_reports_user").on(table.userId)],
);

// ============================================
// Recovery: Movements + Videos + Routines
// ============================================

export const recoveryMovements = pgTable(
  "recovery_movements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    canonicalName: text("canonical_name").notNull(),
    slug: text("slug").notNull(),
    category: text("category").notNull(),
    bodyRegion: text("body_region").array().default(sql`ARRAY[]::text[]`).notNull(),
    description: text("description"),
    defaultPrescription: jsonb("default_prescription").default(sql`'{}'::jsonb`).notNull(),
    isPerSide: boolean("is_per_side").default(false).notNull(),
    isValidated: boolean("is_validated").default(false).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_recovery_movements_category").on(table.category),
    index("idx_recovery_movements_creator").on(table.createdBy),
  ]
);

export const crossfitMovementVideos = pgTable(
  "crossfit_movement_videos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    movementId: uuid("movement_id").notNull().references(() => movements.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(), // 'upload' | 'external'
    storagePath: text("storage_path"),
    externalUrl: text("external_url"),
    externalProvider: text("external_provider"),
    externalVideoId: text("external_video_id"),
    visibility: text("visibility").notNull(), // 'public' | 'gym' | 'private'
    communityId: uuid("community_id").references(() => communities.id, { onDelete: "cascade" }),
    label: text("label"),
    durationSeconds: integer("duration_seconds"),
    posterStoragePath: text("poster_storage_path"),
    rightsConfirmed: boolean("rights_confirmed").default(false).notNull(),
    orderIndex: integer("order_index").default(0).notNull(),
    uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_crossfit_videos_movement").on(table.movementId, table.orderIndex),
  ]
);

export const recoveryMovementVideos = pgTable(
  "recovery_movement_videos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    movementId: uuid("movement_id").notNull().references(() => recoveryMovements.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(), // 'upload' | 'external'
    storagePath: text("storage_path"),
    externalUrl: text("external_url"),
    externalProvider: text("external_provider"),
    externalVideoId: text("external_video_id"),
    visibility: text("visibility").notNull(), // 'public' | 'gym' | 'private'
    communityId: uuid("community_id").references(() => communities.id, { onDelete: "cascade" }),
    label: text("label"),
    durationSeconds: integer("duration_seconds"),
    posterStoragePath: text("poster_storage_path"),
    rightsConfirmed: boolean("rights_confirmed").default(false).notNull(),
    orderIndex: integer("order_index").default(0).notNull(),
    uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_recovery_videos_movement_v2").on(table.movementId, table.orderIndex),
  ]
);

export const recoveryMovementGymOverrides = pgTable("recovery_movement_gym_overrides", {
  id: uuid("id").defaultRandom().primaryKey(),
  movementId: uuid("movement_id").notNull().references(() => recoveryMovements.id, { onDelete: "cascade" }),
  communityId: uuid("community_id").notNull().references(() => communities.id, { onDelete: "cascade" }),
  notesOverride: text("notes_override"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const recoveryRoutines = pgTable("recovery_routines", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  isValidated: boolean("is_validated").default(false).notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  communityId: uuid("community_id").references(() => communities.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const recoveryRoutineMovements = pgTable("recovery_routine_movements", {
  id: uuid("id").defaultRandom().primaryKey(),
  routineId: uuid("routine_id").notNull().references(() => recoveryRoutines.id, { onDelete: "cascade" }),
  movementId: uuid("movement_id").notNull().references(() => recoveryMovements.id, { onDelete: "restrict" }),
  orderIndex: integer("order_index").notNull(),
  prescription: jsonb("prescription").default(sql`'{}'::jsonb`).notNull(),
  notes: text("notes"),
});

// ============================================
// Recovery: Schedules + Assignments
// ============================================

export const recoverySchedules = pgTable("recovery_schedules", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // 'day_keyed' | 'frequency_keyed'
  rotationDays: integer("rotation_days"),
  weeklyTarget: integer("weekly_target"),
  description: text("description"),
  rotationStrategy: text("rotation_strategy").default("progress").notNull(),
  communityId: uuid("community_id").references(() => communities.id, { onDelete: "set null" }),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  isArchived: boolean("is_archived").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  // null = display every day; otherwise array of 0..6 (0=Sunday, matches Date.getDay()).
  activeDaysOfWeek: integer("active_days_of_week").array(),
  // "Every N days" recurrence. When intervalDays is set, the schedule shows
  // only on dates where (date - intervalStartsOn) % intervalDays === 0.
  // Mutually exclusive with activeDaysOfWeek in the UI.
  intervalDays: integer("interval_days"),
  intervalStartsOn: date("interval_starts_on"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const recoveryScheduleSlots = pgTable("recovery_schedule_slots", {
  id: uuid("id").defaultRandom().primaryKey(),
  scheduleId: uuid("schedule_id").notNull().references(() => recoverySchedules.id, { onDelete: "cascade" }),
  dayIndex: integer("day_index"),
  orderIndex: integer("order_index").notNull(),
  movementId: uuid("movement_id").references(() => recoveryMovements.id, { onDelete: "restrict" }),
  routineId: uuid("routine_id").references(() => recoveryRoutines.id, { onDelete: "restrict" }),
  prescription: jsonb("prescription").default(sql`'{}'::jsonb`).notNull(),
  notes: text("notes"),
});

export const recoveryScheduleAssignments = pgTable("recovery_schedule_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  scheduleId: uuid("schedule_id").notNull().references(() => recoverySchedules.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  communityId: uuid("community_id").references(() => communities.id, { onDelete: "cascade" }),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on"),
  durationLabel: text("duration_label"),
  assignedBy: uuid("assigned_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const recoveryAssignmentOverrides = pgTable("recovery_assignment_overrides", {
  id: uuid("id").defaultRandom().primaryKey(),
  assignmentId: uuid("assignment_id").notNull().references(() => recoveryScheduleAssignments.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  startsOn: date("starts_on"),
  endsOn: date("ends_on"),
  isDismissed: boolean("is_dismissed").default(false).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ============================================
// Recovery: Sessions
// ============================================

export const recoverySessions = pgTable("recovery_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  scheduleId: uuid("schedule_id").references(() => recoverySchedules.id, { onDelete: "set null" }),
  assignmentId: uuid("assignment_id").references(() => recoveryScheduleAssignments.id, { onDelete: "set null" }),
  sessionDate: date("session_date").notNull(),
  dayIndex: integer("day_index"),
  status: text("status").default("in_progress").notNull(),
  notes: text("notes"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const recoverySessionItems = pgTable("recovery_session_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id").notNull().references(() => recoverySessions.id, { onDelete: "cascade" }),
  movementId: uuid("movement_id").notNull().references(() => recoveryMovements.id, { onDelete: "restrict" }),
  routineId: uuid("routine_id").references(() => recoveryRoutines.id, { onDelete: "set null" }),
  scheduleSlotId: uuid("schedule_slot_id").references(() => recoveryScheduleSlots.id, { onDelete: "set null" }),
  orderIndex: integer("order_index").notNull(),
  prescribed: jsonb("prescribed").default(sql`'{}'::jsonb`).notNull(),
  actual: jsonb("actual").default(sql`'{}'::jsonb`).notNull(),
  status: text("status").default("pending").notNull(),
  notes: text("notes"),
});

// ============================================
// Social — Reactions, Comments, Notifications
// ============================================
//
// See claude_code_instructions/social/crossfit_leaderboard_social_spec.md
// and migration 20260512140600_add_social_tables.sql.

export const scoreReactions = pgTable("score_reactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  scoreId: uuid("score_id").notNull().references(() => scores.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  reaction: text("reaction").default("fire").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueReaction: uniqueIndex("score_reactions_unique").on(table.scoreId, table.userId, table.reaction),
  scoreIdx: index("score_reactions_score_idx").on(table.scoreId),
  userIdx: index("score_reactions_user_idx").on(table.userId),
}));

export const scoreComments = pgTable("score_comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  scoreId: uuid("score_id").notNull().references(() => scores.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  // Postgres uuid[] — list of user ids tagged in the comment body.
  mentionedUserIds: uuid("mentioned_user_ids").array().notNull().default(sql`ARRAY[]::uuid[]`),
  attachmentProvider: text("attachment_provider"), // 'klipy' in v1
  attachmentKind: text("attachment_kind"),         // 'gif' | 'meme' | 'sticker'
  attachmentId: text("attachment_id"),             // provider-side id
  attachmentUrl: text("attachment_url"),           // provider CDN URL
  attachmentPreviewUrl: text("attachment_preview_url"),
  attachmentWidth: integer("attachment_width"),
  attachmentHeight: integer("attachment_height"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  // Soft delete — read paths filter for deleted_at IS NULL.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  recipientId: uuid("recipient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Nullable so deleting an actor doesn't blow away notifications.
  actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  // See NOTIFICATION_KINDS below for the canonical list.
  kind: text("kind").notNull(),
  // Polymorphic target — exactly one is non-null per row.
  scoreId: uuid("score_id").references(() => scores.id, { onDelete: "cascade" }),
  commentId: uuid("comment_id").references(() => scoreComments.id, { onDelete: "cascade" }),
  reactionId: uuid("reaction_id").references(() => scoreReactions.id, { onDelete: "cascade" }),
  // PR 2 polymorphic targets. FKs declared in the SQL migration so the
  // circular type-level dependency stays at the schema level only.
  gymPostId: uuid("gym_post_id"),
  gymPostCommentId: uuid("gym_post_comment_id"),
  classInstanceId: uuid("class_instance_id"),
  // Denormalized routing context (avoids 3 joins on every render).
  workoutId: uuid("workout_id").references(() => workouts.id, { onDelete: "cascade" }),
  workoutPartId: uuid("workout_part_id").references(() => workoutParts.id, { onDelete: "cascade" }),
  // Unified-schema FKs (populated by the backfill; new writes set these).
  workoutSessionId: uuid("workout_session_id"),
  crossfitWorkoutPartId: uuid("crossfit_workout_part_id"),
  // For workout_published kind: one row per (release × recipient) instead
  // of one per (workout × recipient). Lets the inbox render
  // "Programming dropped — week of <Monday>" from the release row.
  programmingReleaseId: uuid("programming_release_id"),
  communityId: uuid("community_id").references(() => communities.id, { onDelete: "cascade" }),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Canonical list of notification kinds (mirrors the CHECK constraint added
// in migration 20260518100600). New kinds need to be added in three places:
// here, the migration, and src/lib/notifications/copy.ts.
export const NOTIFICATION_KINDS = [
  "score_reaction",
  "score_comment",
  "score_mention",
  "workout_published",
  "social_post_published",
  "social_post_reaction",
  "social_post_comment",
  "social_post_mention",
  "committed_club_progress",
  "committed_club_earned",
  "committed_club_streak",
  "class_cancelled",
  "class_reservation_reminder",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

// Push notification token registry (spec §1.10). The dispatcher Inngest
// function fans notifications out to all tokens registered for the
// recipient. Tokens are de-duped per (user, token); a token rotation
// replaces the row via the unique constraint.
export const pushTokens = pgTable(
  "push_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(), // 'ios' | 'android'
    token: text("token").notNull(),
    deviceId: text("device_id"),
    appVersion: text("app_version"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("push_tokens_user_token_unique").on(table.userId, table.token),
    index("push_tokens_user_id_idx").on(table.userId),
  ]
);

export type PushToken = typeof pushTokens.$inferSelect;
export type NewPushToken = typeof pushTokens.$inferInsert;

export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  inAppEnabled: boolean("in_app_enabled").default(true).notNull(),
  pushEnabled: boolean("push_enabled").default(true).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.kind] }),
}));

// ============================================
// Programming (spec §1.6)
// ============================================

// A coach's 7-day programming bundle for a gym, week-keyed on the gym-local
// Monday. status='draft' until the coach hits Publish, at which point we
// stamp published_at + published_by and notify members.
export const programmingReleases = pgTable(
  "programming_releases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    communityId: uuid("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    weekStart: date("week_start").notNull(),
    status: text("status").notNull(), // 'draft' | 'published'
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: uuid("published_by").references(() => users.id),
    source: text("source").notNull(), // 'cap_import' | 'cap_paste' | 'manual'
    sourceMeta: jsonb("source_meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("programming_releases_community_week_unique").on(
      table.communityId,
      table.weekStart
    ),
  ]
);

// Programming tracks (CAP, monthly challenges, event prep). Schema lives
// here so workoutSections.sourceTrackId has a valid FK target; admin UI
// ships in PR 2 (§2.4).
export const programmingTracks = pgTable("programming_tracks", {
  id: uuid("id").defaultRandom().primaryKey(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => communities.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // 'cap' | 'monthly_challenge' | 'event_prep' | 'custom'
  name: text("name").notNull(),
  description: text("description"),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  displayMode: text("display_mode").notNull(), // 'inline' | 'standalone' | 'inline_and_standalone'
  inlinePosition: text("inline_position"), // 'top' | 'after_wod' | 'before_stretching' | 'before_at_home' | 'end_of_day'
  optInRequired: boolean("opt_in_required").default(false).notNull(),
  scoringConfig: jsonb("scoring_config"),
  status: text("status").default("draft").notNull(), // 'draft' | 'active' | 'archived'
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Typed section grouping for workout_parts. A workout with no sections
// continues to render as a flat body. A workout with sections renders one
// card per section in the CrossFit tab and one full-screen slide per
// section in the TV display.
export const workoutSections = pgTable(
  "workout_sections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workoutId: uuid("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // warm_up | pre_skill | wod | post_skill | stretching | at_home | monthly_challenge | custom
    subKind: text("sub_kind"), // 'skill' | 'strength' | 'accessory'
    position: integer("position").notNull(),
    title: text("title"),
    // Freeform prescription text — used for warm-ups, stretching, or any
    // section the coach wants to write longhand instead of composing via
    // Smart Builder. Smart Builder output still lands in workoutParts.
    body: text("body"),
    // Coach-authored notes that travel with the section. Mirrors the
    // Smart Builder's "Notes (optional)" field; for non-sectioned
    // workouts the equivalent lives on workouts.notes.
    notes: text("notes"),
    isScored: boolean("is_scored").default(false).notNull(),
    scoreType: text("score_type"), // 'time' | 'rounds' | 'reps' | 'weight' | 'no_score'
    // When this section's content came from the Benchmark tab (or was
    // backfilled by title match), this points at the benchmark. The legacy
    // workouts.benchmark_workout_id is still the source of truth for
    // personal /crossfit workouts that are themselves 1:1 with a benchmark;
    // this column is the gym-programming equivalent where benchmarks live
    // inside a section of a larger class day. Benchmark history / stats
    // queries OR over both fields.
    benchmarkWorkoutId: uuid("benchmark_workout_id").references(
      () => benchmarkWorkouts.id,
      { onDelete: "set null" }
    ),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    sourceTrackId: uuid("source_track_id").references(
      () => programmingTracks.id
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("workout_sections_workout_id_position_idx").on(
      table.workoutId,
      table.position
    ),
  ]
);

export type ProgrammingRelease = typeof programmingReleases.$inferSelect;
export type NewProgrammingRelease = typeof programmingReleases.$inferInsert;
export type ProgrammingTrack = typeof programmingTracks.$inferSelect;
export type NewProgrammingTrack = typeof programmingTracks.$inferInsert;
export type WorkoutSection = typeof workoutSections.$inferSelect;
export type NewWorkoutSection = typeof workoutSections.$inferInsert;

// Valid kinds for workout_sections.kind. Mirrors the CHECK constraint in
// the migration so the API layer can validate before the DB does.
export const WORKOUT_SECTION_KINDS = [
  "warm_up",
  "pre_skill",
  "wod",
  "post_skill",
  "stretching",
  "at_home",
  "monthly_challenge",
  "custom",
] as const;
export type WorkoutSectionKind = (typeof WORKOUT_SECTION_KINDS)[number];

export const WORKOUT_SECTION_SCORE_TYPES = [
  "time",
  "rounds",
  "reps",
  "weight",
  "no_score",
] as const;
export type WorkoutSectionScoreType = (typeof WORKOUT_SECTION_SCORE_TYPES)[number];

// Default human label per kind. The coach can override via section.title.
export const WORKOUT_SECTION_KIND_LABELS: Record<WorkoutSectionKind, string> = {
  warm_up: "Warm-up",
  pre_skill: "Pre-skill",
  wod: "WOD",
  post_skill: "Post-skill",
  stretching: "Stretching",
  at_home: "At-home",
  monthly_challenge: "Monthly challenge",
  custom: "Custom",
};

// ============================================
// Programming tracks: per-day prescription + participations (spec §2.4)
// ============================================

export const programmingTrackDays = pgTable(
  "programming_track_days",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    trackId: uuid("track_id")
      .notNull()
      .references(() => programmingTracks.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    // Filled at publish time when an inline track is injected into a workout
    // section. Standalone tracks may leave this null and surface their own
    // log-result CTA.
    workoutId: uuid("workout_id").references(() => workouts.id, { onDelete: "set null" }),
    // Unified-schema FK (populated by the backfill; new writes set this).
    workoutSessionId: uuid("workout_session_id"),
    body: text("body"),
    isScored: boolean("is_scored").default(true).notNull(),
    scoreType: text("score_type"),
    // Structured prescribed amount (e.g. 40 sit-ups). Populated by the
    // progression generator. Drives the "Mark done" auto-fill on non-WOD
    // track days so a Done tap counts toward the monthly rollup.
    prescribedValue: numeric("prescribed_value"),
  },
  (table) => [
    uniqueIndex("programming_track_days_unique").on(table.trackId, table.date),
  ]
);

export const programmingTrackParticipations = pgTable(
  "programming_track_participations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    trackId: uuid("track_id")
      .notNull()
      .references(() => programmingTracks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
    leftAt: timestamp("left_at", { withTimezone: true }),
  }
);

export type ProgrammingTrackDay = typeof programmingTrackDays.$inferSelect;
export type NewProgrammingTrackDay = typeof programmingTrackDays.$inferInsert;
export type ProgrammingTrackParticipation = typeof programmingTrackParticipations.$inferSelect;
export type NewProgrammingTrackParticipation = typeof programmingTrackParticipations.$inferInsert;

// Per-day scoring for non-WOD tracks (sit-up reps, step counts, grams of
// veggies, etc.) — see spec §3.2. WOD-shaped track days route to the
// existing `scores` table; this table is only for `programming_track_days`
// rows that have no linked workout.
export const trackDayScores = pgTable(
  "track_day_scores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    trackDayId: uuid("track_day_id")
      .notNull()
      .references(() => programmingTrackDays.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    numericValue: numeric("numeric_value"),
    textValue: text("text_value"),
    // Denormalized from the parent track's scoring_config at write time so
    // a coach changing the unit mid-month doesn't rewrite past entries.
    unit: text("unit"),
    isComplete: boolean("is_complete").default(true).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("track_day_scores_unique").on(table.trackDayId, table.userId),
    index("track_day_scores_user_idx").on(table.userId, table.createdAt),
  ]
);

export type TrackDayScore = typeof trackDayScores.$inferSelect;
export type NewTrackDayScore = typeof trackDayScores.$inferInsert;

// ============================================
// Classes (spec §2.2)
// ============================================

export const classSchedules = pgTable("class_schedules", {
  id: uuid("id").defaultRandom().primaryKey(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => communities.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  defaultCapacity: integer("default_capacity").default(20).notNull(),
  defaultCoachId: uuid("default_coach_id").references(() => users.id),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const classScheduleSlots = pgTable("class_schedule_slots", {
  id: uuid("id").defaultRandom().primaryKey(),
  scheduleId: uuid("schedule_id")
    .notNull()
    .references(() => classSchedules.id, { onDelete: "cascade" }),
  // RRULE string (e.g. 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR').
  rrule: text("rrule").notNull(),
  // Time of day stored as `time` (HH:MM:SS local-to-gym). The materializer
  // pairs it with the gym timezone to produce an absolute start_at.
  startTime: text("start_time").notNull(),
  durationMin: integer("duration_min").notNull(),
  capacity: integer("capacity"),
  coachId: uuid("coach_id").references(() => users.id),
  activeFrom: date("active_from").notNull(),
  activeTo: date("active_to"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const classInstances = pgTable("class_instances", {
  id: uuid("id").defaultRandom().primaryKey(),
  scheduleId: uuid("schedule_id").references(() => classSchedules.id, { onDelete: "set null" }),
  slotId: uuid("slot_id").references(() => classScheduleSlots.id, { onDelete: "set null" }),
  communityId: uuid("community_id")
    .notNull()
    .references(() => communities.id, { onDelete: "cascade" }),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(),
  coachId: uuid("coach_id").references(() => users.id),
  capacity: integer("capacity").notNull(),
  status: text("status").default("scheduled").notNull(), // 'scheduled' | 'cancelled' | 'completed'
  cancellationReason: text("cancellation_reason"),
  workoutId: uuid("workout_id").references(() => workouts.id),
  // Unified-schema FK (populated by the backfill; new writes set this).
  workoutSessionId: uuid("workout_session_id"),
  kind: text("kind").default("class").notNull(), // 'class' | 'event'
  eventTitle: text("event_title"),
  // PR 3 §3.3 — event creator surfaces these on the schedule card.
  eventImageUrl: text("event_image_url"),
  eventDescription: text("event_description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const classRegistrations = pgTable(
  "class_registrations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    classInstanceId: uuid("class_instance_id")
      .notNull()
      .references(() => classInstances.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull(), // 'registered' | 'cancelled' | 'no_show' | 'attended'
    registeredAt: timestamp("registered_at", { withTimezone: true }).defaultNow().notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    attendedAt: timestamp("attended_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("class_registrations_unique").on(table.classInstanceId, table.userId),
  ]
);

export type ClassSchedule = typeof classSchedules.$inferSelect;
export type NewClassSchedule = typeof classSchedules.$inferInsert;
export type ClassScheduleSlot = typeof classScheduleSlots.$inferSelect;
export type NewClassScheduleSlot = typeof classScheduleSlots.$inferInsert;
export type ClassInstance = typeof classInstances.$inferSelect;
export type NewClassInstance = typeof classInstances.$inferInsert;
export type ClassRegistration = typeof classRegistrations.$inferSelect;
export type NewClassRegistration = typeof classRegistrations.$inferInsert;

export const CLASS_REGISTRATION_STATUSES = [
  "registered",
  "cancelled",
  "no_show",
  "attended",
] as const;
export type ClassRegistrationStatus = (typeof CLASS_REGISTRATION_STATUSES)[number];

// ============================================
// Gym social feed (spec §2.3)
// ============================================

export const gymPosts = pgTable(
  "gym_posts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    communityId: uuid("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    // 'draft' | 'pending_review' | 'published' | 'deleted'.
    // Auto-anniversary/birthday posts insert as 'pending_review'; coach
    // approves → 'published'. Unreviewed posts auto-publish after 24h via
    // an Inngest delayed step.
    status: text("status").default("published").notNull(),
    body: text("body"),
    workoutId: uuid("workout_id").references(() => workouts.id),
    // Unified-schema FK (populated by the backfill; new writes set this).
    workoutSessionId: uuid("workout_session_id"),
    workoutDate: date("workout_date"),
    mentionedUserIds: uuid("mentioned_user_ids")
      .array()
      .notNull()
      .default(sql`ARRAY[]::uuid[]`),
    isPinned: boolean("is_pinned").default(false).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("gym_posts_community_published_idx").on(table.communityId, table.publishedAt),
  ]
);

export const gymPostAttachments = pgTable(
  "gym_post_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    postId: uuid("post_id")
      .notNull()
      .references(() => gymPosts.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // 'image' | 'gif' | 'video'
    url: text("url").notNull(),
    thumbnailUrl: text("thumbnail_url"),
    width: integer("width"),
    height: integer("height"),
    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  }
);

export const gymPostReactions = pgTable(
  "gym_post_reactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    postId: uuid("post_id")
      .notNull()
      .references(() => gymPosts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reaction: text("reaction").default("fire").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("gym_post_reactions_unique").on(
      table.postId,
      table.userId,
      table.reaction
    ),
  ]
);

export const gymPostComments = pgTable("gym_post_comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  postId: uuid("post_id")
    .notNull()
    .references(() => gymPosts.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  mentionedUserIds: uuid("mentioned_user_ids")
    .array()
    .notNull()
    .default(sql`ARRAY[]::uuid[]`),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type GymPost = typeof gymPosts.$inferSelect;
export type NewGymPost = typeof gymPosts.$inferInsert;
export type GymPostAttachment = typeof gymPostAttachments.$inferSelect;
export type NewGymPostAttachment = typeof gymPostAttachments.$inferInsert;
export type GymPostReaction = typeof gymPostReactions.$inferSelect;
export type GymPostComment = typeof gymPostComments.$inferSelect;
export type NewGymPostComment = typeof gymPostComments.$inferInsert;

export const GYM_POST_KINDS = [
  "announcement",
  "whiteboard",
  "auto_anniversary",
  "auto_birthday",
  "meme",
  "pinned",
] as const;
export type GymPostKind = (typeof GYM_POST_KINDS)[number];

export const GYM_POST_STATUSES = [
  "draft",
  "pending_review",
  "published",
  "deleted",
] as const;
export type GymPostStatus = (typeof GYM_POST_STATUSES)[number];

// ============================================
// Committed Club (spec §2.5)
// ============================================

export const committedClubSnapshots = pgTable(
  "committed_club_snapshots",
  {
    communityId: uuid("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    yearMonth: text("year_month").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    classesAttended: integer("classes_attended").notNull(),
    firstInAt: timestamp("first_in_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.communityId, table.yearMonth, table.userId],
    }),
  })
);

export const userStreakCache = pgTable(
  "user_streak_cache",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    communityId: uuid("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    currentStreak: integer("current_streak").default(0).notNull(),
    longestStreak: integer("longest_streak").default(0).notNull(),
    lastQualifiedMonth: text("last_qualified_month"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.communityId] }),
  })
);

export type CommittedClubSnapshot = typeof committedClubSnapshots.$inferSelect;
export type UserStreakCache = typeof userStreakCache.$inferSelect;

// ============================================
// Documents (PR 3 §3.2)
// ============================================
//
// Versioned waivers / policies. A new document_versions row invalidates
// every prior signature for that document — staleness is computed on
// read (no cascade). For v1 the `pdf_url` is left null on signatures;
// the row itself is the audit artifact per spec D8.

export const DOCUMENT_KINDS = [
  "waiver",
  "membership_agreement",
  "policy",
  "custom",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  waiver: "Waiver",
  membership_agreement: "Membership Agreement",
  policy: "Policy",
  custom: "Custom",
};

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Null = system-scoped (e.g. ShredTrack ToS). Per-gym docs reference
    // the gym.
    communityId: uuid("community_id").references(() => communities.id, {
      onDelete: "cascade",
    }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    isRequiredOnJoin: boolean("is_required_on_join").default(false).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdBy: uuid("created_by").references(() => users.id),
  },
  (table) => [index("documents_community_id_idx").on(table.communityId)]
);

export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    bodyMarkdown: text("body_markdown").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    publishedBy: uuid("published_by").references(() => users.id),
  },
  (table) => [
    uniqueIndex("document_versions_document_version_unique").on(
      table.documentId,
      table.version
    ),
  ]
);

export const documentSignatures = pgTable(
  "document_signatures",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    // The signer. For sign-on-behalf, this is the guardian.
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The person the signature applies to. Null = same as userId (the
    // signer signed for themselves). Populated when a guardian signs
    // for a minor dependent (spec §3.5).
    subjectUserId: uuid("subject_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    // 'parent_of_minor' | 'legal_guardian' | null.
    // v1 only emits 'parent_of_minor'.
    signedOnBehalfReason: text("signed_on_behalf_reason"),
    // Free-form audit JSON — captures DOB-at-signing, guardian typed
    // name, IP, etc. so juvenile-era signatures are auditable later.
    signedOnBehalfMeta: jsonb("signed_on_behalf_meta"),
    typedName: text("typed_name").notNull(),
    signedAt: timestamp("signed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    // `inet` is stored as text in Drizzle (no native pg-core helper).
    // Drizzle round-trips the IP string verbatim.
    signedIp: text("signed_ip"),
    pdfUrl: text("pdf_url"),
  },
  (table) => [
    // The unique constraint that actually exists in Postgres is
    // `(document_version_id, coalesce(subject_user_id, user_id))` —
    // declared in migration 20260520120400. Drizzle's uniqueIndex
    // helper can't express COALESCE, so the index name below is here
    // for documentation/introspection only; the migration is the
    // source of truth.
    index("document_signatures_user_id_idx").on(table.userId),
    index("document_signatures_subject_user_id_idx").on(table.subjectUserId),
  ]
);

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentVersion = typeof documentVersions.$inferSelect;
export type NewDocumentVersion = typeof documentVersions.$inferInsert;
export type DocumentSignature = typeof documentSignatures.$inferSelect;
export type NewDocumentSignature = typeof documentSignatures.$inferInsert;
