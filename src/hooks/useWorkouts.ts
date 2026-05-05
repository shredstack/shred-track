import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  repSchemeParsed: RepSchemeParsed | null;
  equipmentCount: number | null;
  rxStandard: string | null;
  notes: string | null;
  workoutBlockId: string | null;
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
  repScheme: string | null;
  rounds: number | null;
  structure: string | null;
  notes: string | null;
  movements: WireMovement[];
  blocks: WireBlock[];
  score: WireScore | null;
}

interface WireWorkout {
  id: string;
  createdBy: string;
  creatorName: string | null;
  communityId: string | null;
  title: string | null;
  description: string | null;
  workoutDate: string;
  benchmarkWorkoutId: string | null;
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
    repSchemeParsed: m.repSchemeParsed,
    equipmentCount: m.equipmentCount ?? undefined,
    rxStandard: m.rxStandard ?? undefined,
    notes: m.notes ?? undefined,
    workoutBlockId: m.workoutBlockId ?? null,
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
    repScheme: p.repScheme ?? undefined,
    rounds: p.rounds ?? undefined,
    structure: (p.structure as WorkoutPartStructure | null) ?? undefined,
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
    benchmarkWorkoutId: w.benchmarkWorkoutId,
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
  scope: WorkoutScopeFilter = { mode: "all" }
) {
  const scopeKey =
    scope.mode === "gym" ? `gym:${scope.communityId}` : scope.mode;
  return useQuery({
    queryKey: ["workouts", "by-date", date, scopeKey],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("date", date);
      if (scope.mode === "gym") params.set("communityId", scope.communityId);
      else if (scope.mode === "personal") params.set("personal", "1");
      const res = await fetch(`/api/workouts?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch workouts");
      const rows = (await res.json()) as WireWorkout[];
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
      const res = await fetch(`/api/workouts?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to search workouts");
      const rows = (await res.json()) as WireWorkout[];
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
  tempo?: string;
  isMaxReps?: boolean;
  isSideCadence?: boolean;
  promoteSequenceToLadder?: boolean;
  equipmentCount?: number;
  rxStandard?: string;
  notes?: string;
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
    queryFn: async () => {
      const res = await fetch(`/api/workouts/${workoutId}/delete-impact`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Failed to load delete impact");
      }
      return res.json();
    },
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workouts"] });
      queryClient.invalidateQueries({ queryKey: ["benchmarks"] });
      queryClient.invalidateQueries({ queryKey: ["benchmark-history"] });
    },
  });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workouts"] });
      queryClient.invalidateQueries({ queryKey: ["benchmarks"] });
      queryClient.invalidateQueries({ queryKey: ["benchmark-history"] });
    },
  });
}
