import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Per-movement result type (stored in JSONB)
// ---------------------------------------------------------------------------

export interface MovementResult {
  blockIndex: number;
  movementIndex: number;
  movementName: string;
  /** Per-set times in seconds, e.g. [92, 88] for 2 sets */
  setTimesSeconds?: number[];
  /** Single total time in seconds (alternative to per-set) */
  timeSeconds?: number;
  /** Weight used */
  weightValue?: number;
  weightUnit?: "kg" | "lb";
  /** Movement-level notes */
  notes?: string;
}

// ---------------------------------------------------------------------------
// Generate plan
// ---------------------------------------------------------------------------

export function useGeneratePlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/hyrox/plan/generate", {
        method: "POST",
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to start plan generation");
      }
      return response.json() as Promise<{ planId: string; generationStatus: string }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hyrox-plan"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Poll generation status
// ---------------------------------------------------------------------------

export function usePlanStatus(planId: string | null) {
  return useQuery({
    queryKey: ["hyrox-plan-status", planId],
    queryFn: async () => {
      const response = await fetch(`/api/hyrox/plan/${planId}/status`);
      if (!response.ok) throw new Error("Failed to fetch plan status");
      return response.json() as Promise<{
        id: string;
        title: string;
        generationStatus: string;
        totalWeeks: number;
      }>;
    },
    enabled: !!planId,
    refetchInterval: (query) => {
      const status = query.state.data?.generationStatus;
      if (status === "pending" || status === "generating") return 2000;
      return false;
    },
  });
}

// ---------------------------------------------------------------------------
// Fetch plan weeks
// ---------------------------------------------------------------------------

export function usePlanWeeks(planId: string | null) {
  return useQuery({
    queryKey: ["hyrox-plan-weeks", planId],
    queryFn: async () => {
      const response = await fetch(`/api/hyrox/plan/${planId}/weeks`);
      if (!response.ok) throw new Error("Failed to fetch plan weeks");
      return response.json();
    },
    enabled: !!planId,
  });
}

// ---------------------------------------------------------------------------
// Fetch scenarios
// ---------------------------------------------------------------------------

export function usePlanScenarios(planId: string | null) {
  return useQuery({
    queryKey: ["hyrox-plan-scenarios", planId],
    queryFn: async () => {
      const response = await fetch(`/api/hyrox/plan/${planId}/scenarios`);
      if (!response.ok) throw new Error("Failed to fetch scenarios");
      return response.json();
    },
    enabled: !!planId,
  });
}

// ---------------------------------------------------------------------------
// Edit session
// ---------------------------------------------------------------------------

export function useEditSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sessionId,
      data,
    }: {
      sessionId: string;
      data: Record<string, unknown>;
    }) => {
      const response = await fetch(`/api/hyrox/plan/sessions/${sessionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to update session");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hyrox-plan-weeks"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Regenerate week
// ---------------------------------------------------------------------------

export function useRegenerateWeek() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      planId,
      week,
      constraints,
    }: {
      planId: string;
      week: number;
      constraints?: string;
    }) => {
      const response = await fetch(
        `/api/hyrox/plan/${planId}/weeks/${week}/regenerate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ constraints }),
        }
      );
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to regenerate week");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hyrox-plan-weeks"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Log a session (upsert)
// ---------------------------------------------------------------------------

export function useLogSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sessionId,
      data,
    }: {
      sessionId: string;
      data: {
        status: "completed" | "skipped" | "modified";
        actualPace?: string;
        actualPaceUnit?: "mi" | "km";
        actualDistance?: string;
        actualDistanceValue?: number;
        actualDistanceUnit?: "mi" | "km";
        actualTimeSeconds?: number;
        actualReps?: number;
        actualWeight?: string;
        actualWeightValue?: number;
        actualWeightUnit?: "kg" | "lb";
        movementResults?: MovementResult[];
        rpe?: number;
        notes?: string;
      };
    }) => {
      const response = await fetch(
        `/api/hyrox/plan/sessions/${sessionId}/log`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      );
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to log session");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hyrox-plan-weeks"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Fetch progress data (logged session aggregates)
// ---------------------------------------------------------------------------

export interface RunProgress {
  week: number;
  sessionTitle: string;
  sessionType: string;
  loggedAt: string;
  actualPace: string | null;
  actualPaceUnit: string | null;
  actualDistanceValue: string | null;
  actualDistanceUnit: string | null;
  targetPace: string | null;
  rpe: number | null;
}

export interface StationProgress {
  week: number;
  sessionTitle: string;
  sessionType: string;
  loggedAt: string;
  actualTimeSeconds: number | null;
  actualReps: number | null;
  actualWeightValue: string | null;
  actualWeightUnit: string | null;
  rpe: number | null;
}

export interface WeeklyTotal {
  week: number;
  totalDistanceKm: number;
  avgRpe: number | null;
  sessionsCompleted: number;
  sessionsTotal: number;
}

export interface ProgressData {
  runs: RunProgress[];
  stations: StationProgress[];
  weeklyTotals: WeeklyTotal[];
}

export function useProgressData(planId: string | null) {
  return useQuery({
    queryKey: ["hyrox-plan-progress", planId],
    queryFn: async () => {
      const response = await fetch(`/api/hyrox/plan/${planId}/progress`);
      if (!response.ok) throw new Error("Failed to fetch progress data");
      return response.json() as Promise<ProgressData>;
    },
    enabled: !!planId,
  });
}

// ---------------------------------------------------------------------------
// Plan history (all plans, active + archived)
// ---------------------------------------------------------------------------

export function usePlanHistory(enabled = true) {
  return useQuery({
    queryKey: ["hyrox-plan-history"],
    queryFn: async () => {
      const response = await fetch("/api/hyrox/plan/history");
      if (!response.ok) throw new Error("Failed to fetch plan history");
      return response.json() as Promise<
        {
          id: string;
          title: string;
          status: string;
          totalWeeks: number;
          startDate: string;
          endDate: string;
          generationStatus: string | null;
          createdAt: string;
        }[]
      >;
    },
    enabled,
  });
}

// ---------------------------------------------------------------------------
// Reorder sessions within a week
// ---------------------------------------------------------------------------

export function useReorderSessions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      planId,
      week,
      assignments,
    }: {
      planId: string;
      week: number;
      assignments: { sessionId: string; dayOfWeek: number }[];
    }) => {
      const response = await fetch(
        `/api/hyrox/plan/${planId}/weeks/${week}/reorder`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignments }),
        }
      );
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to reorder sessions");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hyrox-plan-weeks"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Fetch user's HYROX profile (division, goal time, etc.)
// ---------------------------------------------------------------------------

export interface HyroxProfile {
  id: string;
  targetDivision: string;
  gender: string | null;
  goalFinishTimeSeconds: number | null;
  preferredUnits: string | null;
}

export function useHyroxProfile() {
  return useQuery({
    queryKey: ["hyrox-profile"],
    queryFn: async () => {
      const response = await fetch("/api/hyrox/profile");
      if (!response.ok) throw new Error("Failed to fetch profile");
      return response.json() as Promise<HyroxProfile | null>;
    },
  });
}

// ---------------------------------------------------------------------------
// Fetch active plan (lightweight — for dashboard)
// ---------------------------------------------------------------------------

export function useActivePlan() {
  return useQuery({
    queryKey: ["hyrox-plan"],
    queryFn: async () => {
      const response = await fetch("/api/hyrox/plan");
      if (!response.ok) throw new Error("Failed to fetch plan");
      return response.json();
    },
    refetchInterval: (query) => {
      const status = query.state.data?.generationStatus;
      if (status === "pending" || status === "generating") return 3000;
      return false;
    },
  });
}
