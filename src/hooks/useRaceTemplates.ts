import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RaceTemplateSegment } from "@/db/schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RaceTemplate {
  id: string;
  userId: string;
  name: string;
  divisionKey: string | null;
  simulateRoxzone: boolean;
  segments: RaceTemplateSegment[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateRaceTemplateInput {
  name: string;
  divisionKey?: string | null;
  simulateRoxzone?: boolean;
  segments: RaceTemplateSegment[];
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const raceTemplateKeys = {
  all: ["race-templates"] as const,
  lists: () => [...raceTemplateKeys.all, "list"] as const,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useRaceTemplates() {
  return useQuery({
    queryKey: raceTemplateKeys.lists(),
    queryFn: async (): Promise<RaceTemplate[]> => {
      const response = await fetch("/api/hyrox/race-templates");
      if (!response.ok) throw new Error("Failed to load templates");
      return response.json();
    },
  });
}

export function useCreateRaceTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateRaceTemplateInput): Promise<RaceTemplate> => {
      const response = await fetch("/api/hyrox/race-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Failed to save template");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: raceTemplateKeys.lists() });
    },
  });
}

export function useDeleteRaceTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const response = await fetch(`/api/hyrox/race-templates/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Failed to delete template");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: raceTemplateKeys.lists() });
    },
  });
}
