import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson } from "@/lib/api-fetch";
import { pushTodaySnapshotToWatch } from "@/lib/native/today-snapshot";
import type { UserProfile } from "@/hooks/useProfile";
import type {
  WorkoutDisplay,
  WorkoutPartDisplay,
  WorkoutPartStructure,
  WorkoutMovementDisplay,
  WorkoutBlockDisplay,
  WorkoutType,
  ScoreInput,
  MovementCategory,
  MovementMetricType,
  ScoreDisplay,
  SetEntry,
  IntervalRoundSpec,
} from "@/types/crossfit";
import type { RepSchemeParsed } from "@/lib/crossfit/rep-scheme-parser";

// ============================================
// Wire types (what the API returns)
// ============================================

interface WireMovement {
  id: string;
  movementId: string;
  movementName: string;
  category: string;
  isWeighted: boolean;
  metricType: MovementMetricType;
  orderIndex: number;
  prescribedReps: string | null;
  prescribedWeightMale: string | null;
  prescribedWeightFemale: string | null;
  // Free-text so rep schemes ("75-50-25") and scalars ("21") are both
  // valid. The wire keeps the raw string; display formatting parses it.
  prescribedCaloriesMale: string | null;
  prescribedCaloriesFemale: string | null;
  prescribedDistanceMale: string | null;
  prescribedDistanceFemale: string | null;
  prescribedDurationSecondsMale: number | null;
  prescribedDurationSecondsFemale: number | null;
  prescribedHeightInches: number | null;
  prescribedHeightInchesMale: number | null;
  prescribedHeightInchesFemale: number | null;
  prescribedWeightMaleBwMultiplier: number | null;
  prescribedWeightFemaleBwMultiplier: number | null;
  prescribedWeightPct: number | null;
  prescribedWeightPctSourcePartId: string | null;
  tempo: string | null;
  isMaxReps: boolean;
  captureDurationPerRound: boolean;
  isSideCadence: boolean;
  repSchemeParsed: RepSchemeParsed | null;
  equipmentCount: number | null;
  rxStandard: string | null;
  notes: string | null;
  workoutBlockId: string | null;
  weightSource?: "prescribed" | "athlete" | null;
}

interface WireBlock {
  id: string;
  orderIndex: number;
  title: string;
}

interface WireMovementDetail {
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

interface WireScore {
  id: string;
  workoutPartId: string | null;
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
  woreVest?: boolean | null;
  vestWeightLb?: number;
  estimatedKcal?: number | null;
  estimatedKcalActive?: number | null;
  estimatedKcalWithEpoc?: number | null;
  estimatedKcalActiveWithEpoc?: number | null;
  estimatedKcalConfidence?: "high" | "medium" | "low" | null;
  movementDetails?: WireMovementDetail[];
}

interface WirePart {
  id: string;
  orderIndex: number;
  label: string | null;
  workoutType: string;
  timeCapSeconds: number | null;
  amrapDurationSeconds: number | null;
  emomIntervalSeconds: number | null;
  intervalWorkSeconds: number | null;
  intervalRestSeconds: number | null;
  intervalRounds: IntervalRoundSpec[] | null;
  sideCadenceIntervalSeconds: number | null;
  sideCadenceOpenEnded: boolean | null;
  repScheme: string | null;
  rounds: number | null;
  structure: string | null;
  scoreType?: "reps" | "load" | null;
  notes: string | null;
  movements: WireMovement[];
  blocks: WireBlock[];
  score: WireScore | null;
}

interface WireSection {
  id: string;
  kind:
    | "warm_up"
    | "pre_skill"
    | "wod"
    | "post_skill"
    | "stretching"
    | "at_home"
    | "monthly_challenge"
    | "custom";
  position: number;
  title: string | null;
  isScored: boolean;
  scoreType:
    | "time"
    | "rounds"
    | "reps"
    | "weight"
    | "no_score"
    | null;
  partIds: string[];
}

interface WireWorkout {
  id: string;
  createdBy: string;
  creatorName: string | null;
  communityId: string | null;
  communityName: string | null;
  communityLogoUrl: string | null;
  title: string | null;
  description: string | null;
  workoutDate: string;
  benchmarkWorkoutId: string | null;
  requiresVest?: boolean | null;
  vestWeightMaleLb?: number | null;
  vestWeightFemaleLb?: number | null;
  isPartner?: boolean | null;
  partnerCount?: number | null;
  estimatedKcalLow?: number | null;
  estimatedKcalHigh?: number | null;
  estimatedKcalConfidence?: "high" | "medium" | "low" | null;
  sections?: WireSection[];
  parts: WirePart[];
}

// ============================================
// Wire → display mappers
// ============================================

function wireMovementToDisplay(m: WireMovement): WorkoutMovementDisplay {
  return {
    id: m.id,
    movementId: m.movementId,
    movementName: m.movementName,
    category: m.category as MovementCategory,
    isWeighted: m.isWeighted,
    metricType: m.metricType,
    orderIndex: m.orderIndex,
    prescribedReps: m.prescribedReps ?? undefined,
    prescribedWeightMale: m.prescribedWeightMale ?? undefined,
    prescribedWeightFemale: m.prescribedWeightFemale ?? undefined,
    prescribedCaloriesMale: m.prescribedCaloriesMale ?? undefined,
    prescribedCaloriesFemale: m.prescribedCaloriesFemale ?? undefined,
    prescribedDistanceMale: m.prescribedDistanceMale ?? undefined,
    prescribedDistanceFemale: m.prescribedDistanceFemale ?? undefined,
    prescribedDurationSecondsMale: m.prescribedDurationSecondsMale ?? undefined,
    prescribedDurationSecondsFemale:
      m.prescribedDurationSecondsFemale ?? undefined,
    prescribedHeightInches: m.prescribedHeightInches ?? undefined,
    prescribedHeightInchesMale: m.prescribedHeightInchesMale ?? undefined,
    prescribedHeightInchesFemale: m.prescribedHeightInchesFemale ?? undefined,
    prescribedWeightMaleBwMultiplier:
      m.prescribedWeightMaleBwMultiplier ?? undefined,
    prescribedWeightFemaleBwMultiplier:
      m.prescribedWeightFemaleBwMultiplier ?? undefined,
    prescribedWeightPct: m.prescribedWeightPct ?? undefined,
    prescribedWeightPctSourcePartId:
      m.prescribedWeightPctSourcePartId ?? undefined,
    tempo: m.tempo ?? undefined,
    isMaxReps: m.isMaxReps,
    captureDurationPerRound: m.captureDurationPerRound,
    isSideCadence: m.isSideCadence,
    repSchemeParsed: m.repSchemeParsed,
    equipmentCount: m.equipmentCount ?? undefined,
    rxStandard: m.rxStandard ?? undefined,
    notes: m.notes ?? undefined,
    workoutBlockId: m.workoutBlockId ?? null,
    weightSource: m.weightSource ?? "prescribed",
  };
}

function wireBlockToDisplay(b: WireBlock): WorkoutBlockDisplay {
  return { id: b.id, orderIndex: b.orderIndex, title: b.title };
}

function wireScoreToDisplay(s: WireScore): ScoreDisplay {
  return {
    id: s.id,
    workoutPartId: s.workoutPartId ?? undefined,
    division: s.division,
    timeSeconds: s.timeSeconds,
    rounds: s.rounds,
    remainderReps: s.remainderReps,
    weightLbs: s.weightLbs,
    totalReps: s.totalReps,
    scoreText: s.scoreText,
    hitTimeCap: s.hitTimeCap,
    notes: s.notes,
    rpe: s.rpe,
    woreVest: s.woreVest ?? null,
    vestWeightLb: s.vestWeightLb,
    estimatedKcal: s.estimatedKcal ?? null,
    estimatedKcalActive: s.estimatedKcalActive ?? null,
    estimatedKcalWithEpoc: s.estimatedKcalWithEpoc ?? null,
    estimatedKcalActiveWithEpoc: s.estimatedKcalActiveWithEpoc ?? null,
    estimatedKcalConfidence: s.estimatedKcalConfidence ?? null,
    movementDetails: s.movementDetails,
  };
}

function wirePartToDisplay(p: WirePart): WorkoutPartDisplay {
  return {
    id: p.id,
    orderIndex: p.orderIndex,
    label: p.label,
    workoutType: p.workoutType as WorkoutType,
    timeCapSeconds: p.timeCapSeconds ?? undefined,
    amrapDurationSeconds: p.amrapDurationSeconds ?? undefined,
    emomIntervalSeconds: p.emomIntervalSeconds ?? undefined,
    intervalWorkSeconds: p.intervalWorkSeconds ?? undefined,
    intervalRestSeconds: p.intervalRestSeconds ?? undefined,
    intervalRounds: p.intervalRounds ?? undefined,
    sideCadenceIntervalSeconds: p.sideCadenceIntervalSeconds ?? undefined,
    sideCadenceOpenEnded: p.sideCadenceOpenEnded ?? undefined,
    repScheme: p.repScheme ?? undefined,
    rounds: p.rounds ?? undefined,
    structure: (p.structure as WorkoutPartStructure | null) ?? undefined,
    scoreType: p.scoreType ?? undefined,
    notes: p.notes ?? undefined,
    movements: p.movements.map(wireMovementToDisplay),
    blocks: (p.blocks ?? []).map(wireBlockToDisplay),
    score: p.score ? wireScoreToDisplay(p.score) : null,
  };
}

function wireWorkoutToDisplay(w: WireWorkout): WorkoutDisplay {
  return {
    id: w.id,
    title: w.title ?? undefined,
    description: w.description ?? undefined,
    workoutDate: w.workoutDate,
    createdBy: w.createdBy,
    createdByName: w.creatorName ?? undefined,
    communityId: w.communityId,
    communityName: w.communityName,
    communityLogoUrl: w.communityLogoUrl,
    sections: w.sections ?? [],
    benchmarkWorkoutId: w.benchmarkWorkoutId,
    requiresVest: w.requiresVest ?? undefined,
    vestWeightMaleLb: w.vestWeightMaleLb ?? undefined,
    vestWeightFemaleLb: w.vestWeightFemaleLb ?? undefined,
    isPartner: w.isPartner ?? undefined,
    partnerCount: w.partnerCount ?? undefined,
    estimatedKcalLow: w.estimatedKcalLow ?? null,
    estimatedKcalHigh: w.estimatedKcalHigh ?? null,
    estimatedKcalConfidence: w.estimatedKcalConfidence ?? null,
    parts: w.parts.map(wirePartToDisplay),
  };
}

// ============================================
// Queries
// ============================================

export type WorkoutScopeFilter =
  | { mode: "all" }
  | { mode: "personal" }
  | { mode: "gym"; communityId: string };

/**
 * Fetch workouts for a single date, optionally scoped to a gym or personal-only.
 *
 * - `{ mode: "all" }` (default) — caller's personal workouts plus any gym
 *   they're an active member of. Used on Insights and the default CrossFit
 *   day view when there's no active gym.
 * - `{ mode: "personal" }` — caller's personal (community_id IS NULL)
 *   workouts only. Used by the "My personal workouts" toggle.
 * - `{ mode: "gym", communityId }` — gym programming view. Visible to all
 *   active members of the gym, not just the creator.
 */
export function useWorkoutsByDate(
  date: string,
  scope: WorkoutScopeFilter = { mode: "all" },
  options?: { enabled?: boolean }
) {
  const scopeKey =
    scope.mode === "gym" ? `gym:${scope.communityId}` : scope.mode;
  return useQuery({
    queryKey: ["workouts", "by-date", date, scopeKey],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("date", date);
      if (scope.mode === "gym") params.set("communityId", scope.communityId);
      else if (scope.mode === "personal") params.set("personal", "1");
      const rows = await fetchJson<WireWorkout[]>(
        `/api/workouts?${params.toString()}`,
      );
      return rows.map(wireWorkoutToDisplay);
    },
  });
}

// ============================================
// useWorkoutSearch — for the search/browse page
// ============================================
//
// Disabled when every filter is empty so we don't fetch the full history just
// because the page rendered. Callers should pass whatever filters the user
// has set; an all-empty object returns `undefined` with loading=false.

export interface WorkoutSearchFilters {
  q?: string;
  movementId?: string;
  startDate?: string;
  endDate?: string;
}

export function useWorkoutSearch(filters: WorkoutSearchFilters) {
  const { q, movementId, startDate, endDate } = filters;
  const hasAnyFilter = !!(q?.trim() || movementId || startDate || endDate);

  return useQuery({
    queryKey: ["workouts", "search", { q: q?.trim() || "", movementId, startDate, endDate }],
    enabled: hasAnyFilter,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (q?.trim()) params.set("q", q.trim());
      if (movementId) params.set("movementId", movementId);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      const rows = await fetchJson<WireWorkout[]>(
        `/api/workouts?${params.toString()}`,
      );
      return rows.map(wireWorkoutToDisplay);
    },
  });
}

// ============================================
// Mutations
// ============================================

export interface CreatePartMovementInput {
  // Real DB id when editing — keeps the row (and its score detail) in place.
  id?: string;
  movementId: string;
  orderIndex: number;
  prescribedReps?: string;
  prescribedWeightMale?: number;
  prescribedWeightFemale?: number;
  prescribedCaloriesMale?: number | string;
  prescribedCaloriesFemale?: number | string;
  prescribedDistanceMale?: number | string;
  prescribedDistanceFemale?: number | string;
  // PushPress Parity additions. Server parses free-text strings via
  // duration-parser; numeric values are written as-is.
  prescribedDurationSecondsMale?: number | string;
  prescribedDurationSecondsFemale?: number | string;
  prescribedHeightInches?: number | string;
  prescribedHeightInchesMale?: number | string;
  prescribedHeightInchesFemale?: number | string;
  prescribedWeightMaleBwMultiplier?: number | string;
  prescribedWeightFemaleBwMultiplier?: number | string;
  // weight_pct Rx — the percentage, plus the builder tempId of the earlier
  // for_load part it anchors to. The save route resolves the tempRef to a
  // real workout_parts id (parts are upserted before their dependents).
  prescribedWeightPct?: number | string;
  weightPctSourcePartTempRef?: string | null;
  tempo?: string;
  isMaxReps?: boolean;
  isSideCadence?: boolean;
  promoteSequenceToLadder?: boolean;
  equipmentCount?: number;
  rxStandard?: string;
  notes?: string;
  weightSource?: "prescribed" | "athlete";
  // Block membership. `blockId` is a round-tripped DB id (edit flow);
  // `blockTempRef` references a CreatePartBlockInput.tempRef on the same
  // part for newly-created blocks. Either may be null = ungrouped.
  blockId?: string | null;
  blockTempRef?: string | null;
}

export interface CreatePartBlockInput {
  id?: string;
  tempRef?: string;
  title: string;
  orderIndex?: number;
}

export interface CreatePartInput {
  // Real DB id when editing — keeps the row (and its score) in place.
  id?: string;
  // Builder tempId for this part. Always sent so weight_pct movements in
  // later parts can resolve their source-part reference on the server.
  tempRef?: string;
  label?: string;
  workoutType: WorkoutType;
  timeCapSeconds?: number;
  amrapDurationSeconds?: number;
  emomIntervalSeconds?: number;
  intervalWorkSeconds?: number | string;
  intervalRestSeconds?: number | string;
  intervalRounds?: { workSeconds: number | string; restSeconds: number | string }[];
  sideCadenceIntervalSeconds?: number | string;
  sideCadenceOpenEnded?: boolean;
  repScheme?: string;
  rounds?: number;
  structure?: WorkoutPartStructure;
  scoreType?: "reps" | "load" | null;
  notes?: string;
  movements: CreatePartMovementInput[];
  blocks?: CreatePartBlockInput[];
}

export interface CreateWorkoutInput {
  title?: string;
  description?: string;
  workoutDate: string;
  benchmarkWorkoutId?: string;
  /** Set to a gym's id to make this gym programming. Caller must be a
   *  coach/admin of that gym. Omit/null for a personal workout. */
  communityId?: string | null;
  requiresVest?: boolean;
  vestWeightMaleLb?: number;
  vestWeightFemaleLb?: number;
  isPartner?: boolean;
  partnerCount?: number;
  parts: CreatePartInput[];
}

export interface UpdateWorkoutInput {
  title?: string;
  description?: string;
  workoutDate: string;
  requiresVest?: boolean;
  vestWeightMaleLb?: number;
  vestWeightFemaleLb?: number;
  isPartner?: boolean;
  partnerCount?: number;
  parts: CreatePartInput[];
}

export function useCreateWorkout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateWorkoutInput) => {
      const res = await fetch("/api/workouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Failed to create workout");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workouts"] });
      queryClient.invalidateQueries({ queryKey: ["movements", "recent"] });
    },
  });
}

export function useUpdateWorkout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string;
      input: UpdateWorkoutInput;
    }) => {
      const res = await fetch(`/api/workouts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Failed to update workout");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workouts"] });
      queryClient.invalidateQueries({ queryKey: ["movements", "recent"] });
    },
  });
}

export function useDeleteWorkout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/workouts/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Failed to delete workout");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workouts"] });
    },
  });
}

export function useMoveWorkoutToGym() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      workoutId,
      communityId,
    }: {
      workoutId: string;
      communityId: string;
    }) => {
      const res = await fetch(`/api/workouts/${workoutId}/move-to-gym`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ communityId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Failed to move workout to gym");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workouts"] });
    },
  });
}

export interface WorkoutDeleteImpact {
  totalScores: number;
  uniqueAthletes: number;
  otherAthletes: number;
}

export function useWorkoutDeleteImpact(workoutId: string | null) {
  return useQuery<WorkoutDeleteImpact>({
    queryKey: ["workouts", "delete-impact", workoutId],
    queryFn: () =>
      fetchJson<WorkoutDeleteImpact>(
        `/api/workouts/${workoutId}/delete-impact`,
      ),
    enabled: !!workoutId,
    staleTime: 0,
  });
}

export function useLogScore() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (score: ScoreInput) => {
      const res = await fetch("/api/scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(score),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Failed to log score");
      }
      return res.json();
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["workouts"] });
      queryClient.invalidateQueries({ queryKey: ["benchmarks"] });
      queryClient.invalidateQueries({ queryKey: ["benchmark-history"] });
      void pushTodaySnapshotToWatch();
      void maybePushToAppleHealth(saved, queryClient);
    },
  });
}

// Parse a YYYY-MM-DD `workoutDate` (no TZ) as the user's local noon. Noon
// avoids midnight edge cases where a small TZ shift would slide the
// workout into the previous/next day in Apple Health.
function parseWorkoutDateLocalNoon(workoutDate?: string | null): number | null {
  if (!workoutDate) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(workoutDate);
  if (!match) return null;
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d), 12, 0, 0, 0).getTime();
}

// Treat a WOD as "too old to push" once today's local date is more than
// one calendar day past the WOD's local date. Same-day and yesterday →
// push; older → skip. Calendar days (not 24-hour windows) so the cutoff
// doesn't slide with the time of day the user happens to log.
function isOlderThanOneCalendarDay(wodMs: number): boolean {
  const startOfDay = (ms: number) => {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const daysDiff = (startOfDay(Date.now()) - startOfDay(wodMs)) / 86_400_000;
  return daysDiff > 1;
}

// Best-effort Apple Health push. Lives outside the mutation chain so a
// HealthKit failure never bubbles into the UI as a score-save error.
async function maybePushToAppleHealth(
  saved: {
    id?: string;
    startedAt?: string | null;
    endedAt?: string | null;
    durationSeconds?: number | null;
    estimatedKcalActiveWithEpoc?: number | null;
    appleHealthWorkoutUuid?: string | null;
    appleHealthMetadata?: Record<string, string | number> | null;
    workoutDate?: string | null;
  },
  queryClient: QueryClient,
): Promise<void> {
  if (!saved?.id) return;
  // Note: we used to bail when `appleHealthWorkoutUuid` was set, but that
  // dropped score-edit changes (RPE, calorie tweaks, etc.) on the floor.
  // The push call now treats an existing UUID as a "replace" signal —
  // delete the old HK record, write a fresh one, and tell the server to
  // overwrite the stored UUID.
  const active = saved.estimatedKcalActiveWithEpoc;
  if (active == null || active <= 0) return;

  // Read pref from the React Query cache so we don't add a round-trip on
  // every score save. If the cache is cold (user hasn't visited a page that
  // loaded the profile yet) we conservatively skip the push — the next save
  // after the profile loads will pick it up.
  const cached = queryClient.getQueryData<UserProfile>(["user-profile"]);
  if (!cached) return;
  const pushPref = cached.pushToAppleHealth !== false;
  if (!pushPref) return;

  // Decide the time window for the HK workout record.
  //
  // Live timer trumps everything: if the athlete bracketed the workout
  // with start/stop, those wall-clock timestamps are authoritative.
  //
  // Otherwise (back-log or quick-log), key off the WOD's programmed date.
  // Back-logs more than a calendar day old are skipped — we don't want to
  // pollute today's Move ring with old workouts, and Apple Health credit
  // for a 3-month-old workout isn't meaningful anyway.
  const start = saved.startedAt ? new Date(saved.startedAt).getTime() : null;
  const end = saved.endedAt ? new Date(saved.endedAt).getTime() : null;
  let fromMs: number | null = start;
  let toMs: number | null = end;

  if (toMs == null) {
    const wodMs = parseWorkoutDateLocalNoon(saved.workoutDate);
    if (wodMs == null) return; // no WOD date and no bracket — nothing safe to stamp
    if (isOlderThanOneCalendarDay(wodMs)) return; // back-log too old; skip the push
    toMs = wodMs;
  }
  if (fromMs == null) {
    const dur = (saved.durationSeconds ?? 0) * 1000;
    fromMs = dur > 0 ? toMs - dur : toMs - 30 * 60 * 1000; // last-ditch 30 min
  }

  const mod = await import("@/lib/native/push-score-to-health");
  const { status } = await mod.pushScoreToAppleHealth({
    scoreId: saved.id,
    fromMs,
    toMs,
    activeEnergyKcal: active,
    pushPrefEnabled: pushPref,
    metadata: saved.appleHealthMetadata ?? undefined,
    existingWorkoutUuid: saved.appleHealthWorkoutUuid ?? null,
  });

  // Surface the outcome so the user knows their workout reached Apple Health.
  // Only the user-visible outcomes get a toast — `skipped` / `denied` /
  // `unavailable` stay quiet (pref off, web, or the system permission dialog
  // already spoke for itself).
  if (status === "ok") {
    toast.success("Added to Apple Health", {
      description: `~${Math.round(active)} kcal logged to your Move ring.`,
    });
  } else if (status === "updated") {
    toast.success("Updated in Apple Health", {
      description: `~${Math.round(active)} kcal — your Move ring now reflects the edit.`,
    });
  } else if (status === "overlap") {
    toast.info("Apple Watch already logged this", {
      description: "Skipped the Apple Health push so your calories aren't double-counted.",
    });
  }
}

export function useUpdateScore() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      scoreId,
      score,
    }: {
      scoreId: string;
      score: ScoreInput;
    }) => {
      const res = await fetch(`/api/scores/${scoreId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(score),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Failed to update score");
      }
      return res.json();
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["workouts"] });
      queryClient.invalidateQueries({ queryKey: ["benchmarks"] });
      queryClient.invalidateQueries({ queryKey: ["benchmark-history"] });
      void maybePushToAppleHealth(saved, queryClient);
    },
  });
}
