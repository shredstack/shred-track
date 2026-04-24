import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  WorkoutDisplay,
  WorkoutPartDisplay,
  WorkoutMovementDisplay,
  WorkoutType,
  ScoreInput,
  MovementCategory,
  ScoreDisplay,
} from "@/types/crossfit";

// ============================================
// Wire types (what the API returns)
// ============================================

interface WireMovement {
  id: string;
  movementId: string;
  movementName: string;
  category: string;
  isWeighted: boolean;
  orderIndex: number;
  prescribedReps: string | null;
  prescribedWeightMale: string | null;
  prescribedWeightFemale: string | null;
  equipmentCount: number | null;
  rxStandard: string | null;
  notes: string | null;
}

interface WireMovementDetail {
  workoutMovementId: string;
  wasRx: boolean;
  actualWeight?: number;
  actualReps?: string;
  modification?: string;
  substitutionMovementId?: string;
  setWeights?: number[];
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
  notes: string | null;
  movements: WireMovement[];
  score: WireScore | null;
}

interface WireWorkout {
  id: string;
  createdBy: string;
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
    orderIndex: m.orderIndex,
    prescribedReps: m.prescribedReps ?? undefined,
    prescribedWeightMale: m.prescribedWeightMale ?? undefined,
    prescribedWeightFemale: m.prescribedWeightFemale ?? undefined,
    equipmentCount: m.equipmentCount ?? undefined,
    rxStandard: m.rxStandard ?? undefined,
    notes: m.notes ?? undefined,
  };
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
    notes: p.notes ?? undefined,
    movements: p.movements.map(wireMovementToDisplay),
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
    benchmarkWorkoutId: w.benchmarkWorkoutId,
    parts: w.parts.map(wirePartToDisplay),
  };
}

// ============================================
// Queries
// ============================================

export function useWorkoutsByDate(date: string) {
  return useQuery({
    queryKey: ["workouts", "by-date", date],
    queryFn: async () => {
      const res = await fetch(`/api/workouts?date=${encodeURIComponent(date)}`);
      if (!res.ok) throw new Error("Failed to fetch workouts");
      const rows = (await res.json()) as WireWorkout[];
      return rows.map(wireWorkoutToDisplay);
    },
  });
}

// ============================================
// Mutations
// ============================================

export interface CreatePartMovementInput {
  movementId: string;
  orderIndex: number;
  prescribedReps?: string;
  prescribedWeightMale?: number;
  prescribedWeightFemale?: number;
  equipmentCount?: number;
  rxStandard?: string;
  notes?: string;
}

export interface CreatePartInput {
  label?: string;
  workoutType: WorkoutType;
  timeCapSeconds?: number;
  amrapDurationSeconds?: number;
  emomIntervalSeconds?: number;
  repScheme?: string;
  notes?: string;
  movements: CreatePartMovementInput[];
}

export interface CreateWorkoutInput {
  title?: string;
  description?: string;
  workoutDate: string;
  benchmarkWorkoutId?: string;
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
    },
  });
}
