import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RaceTemplateSegment } from "@/db/schema";
import { pushRaceTemplatesToWatch } from "@/lib/native/race-templates-snapshot";

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
  communityId: string | null;
  clonedFromId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Read-only view of another gym member's shared template. */
export interface GymRaceTemplate {
  id: string;
  name: string;
  divisionKey: string | null;
  simulateRoxzone: boolean;
  segments: RaceTemplateSegment[];
  communityId: string;
  authorId: string;
  authorName: string;
  authorIsCoach: boolean;
  createdAt: string;
}

export interface RaceTemplatesResponse {
  mine: RaceTemplate[];
  gym: GymRaceTemplate[];
}

export interface CreateRaceTemplateInput {
  name: string;
  divisionKey?: string | null;
  simulateRoxzone?: boolean;
  segments: RaceTemplateSegment[];
  /** When set, the template is shared with that gym (must be a member). */
  communityId?: string | null;
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
  const query = useQuery({
    queryKey: raceTemplateKeys.lists(),
    queryFn: async (): Promise<RaceTemplatesResponse> => {
      const response = await fetch("/api/hyrox/race-templates");
      if (!response.ok) throw new Error("Failed to load templates");
      return response.json();
    },
  });

  // Mirror the user's own list to the paired Apple Watch. Gym templates
  // aren't pushed — the user clones them into Mine first, which
  // automatically lands them in this list and triggers another push.
  useEffect(() => {
    if (query.data?.mine) {
      void pushRaceTemplatesToWatch(query.data.mine);
    }
  }, [query.data]);

  return query;
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

/**
 * Clones a gym member's shared template into the caller's own list. The
 * clone is always private (communityId = null) so subsequent edits don't
 * leak back to the gym view. Returns the new clone so the UI can select
 * it after switching to the "Mine" tab.
 */
export function useCloneRaceTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sourceId: string): Promise<RaceTemplate> => {
      const response = await fetch(
        `/api/hyrox/race-templates/${sourceId}/clone`,
        { method: "POST" },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Failed to clone template");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: raceTemplateKeys.lists() });
    },
  });
}
