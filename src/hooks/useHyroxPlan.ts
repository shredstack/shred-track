import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

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
