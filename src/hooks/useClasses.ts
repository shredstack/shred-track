"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface ClassInstanceListItem {
  id: string;
  scheduleId: string | null;
  name: string;
  startAt: string;
  endAt: string;
  coachId: string | null;
  coachName: string | null;
  capacity: number;
  status: "scheduled" | "cancelled" | "completed";
  kind: "class" | "event";
  // Event metadata (null for regular classes). Surfaced when the row
  // renders as a banner card on the member schedule.
  eventTitle: string | null;
  eventImageUrl: string | null;
  eventDescription: string | null;
  workoutId: string | null;
  registeredCount: number;
  myStatus: "registered" | "cancelled" | "no_show" | "attended" | null;
  isManager: boolean;
}

export function useGymClasses(
  communityId: string | null,
  fromIso: string,
  toIso: string
) {
  return useQuery<{ instances: ClassInstanceListItem[] }>({
    queryKey: ["gym", communityId, "classes", fromIso, toIso],
    enabled: !!communityId,
    queryFn: async () => {
      const res = await fetch(
        `/api/gym/${communityId}/classes/instances?from=${fromIso}&to=${toIso}`
      );
      if (!res.ok) throw new Error("Failed to load classes");
      return res.json();
    },
  });
}

/**
 * Upcoming events across the next ~12 weeks. Members see this above the
 * weekly class grid so a Murph or partner WOD isn't hidden behind a
 * week-paginator.
 */
export function useUpcomingEvents(communityId: string | null) {
  return useQuery<{ instances: ClassInstanceListItem[] }>({
    queryKey: ["gym", communityId, "upcoming-events"],
    enabled: !!communityId,
    queryFn: async () => {
      const today = new Date();
      const to = new Date(today.getTime() + 84 * 86_400_000);
      const from = today.toISOString().slice(0, 10);
      const toIso = to.toISOString().slice(0, 10);
      const res = await fetch(
        `/api/gym/${communityId}/classes/instances?from=${from}&to=${toIso}&kind=event`
      );
      if (!res.ok) throw new Error("Failed to load events");
      return res.json();
    },
  });
}

function invalidateClassesAndEvents(
  qc: ReturnType<typeof useQueryClient>,
  communityId: string | null,
  fromIso: string,
  toIso: string
) {
  qc.invalidateQueries({
    queryKey: ["gym", communityId, "classes", fromIso, toIso],
  });
  qc.invalidateQueries({
    queryKey: ["gym", communityId, "upcoming-events"],
  });
}

export function useRegisterForClass(
  communityId: string | null,
  fromIso: string,
  toIso: string
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (classInstanceId: string) => {
      const res = await fetch(`/api/classes/${classInstanceId}/register`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Could not register");
      }
    },
    onSuccess: () =>
      invalidateClassesAndEvents(qc, communityId, fromIso, toIso),
  });
}

export function useUnregisterFromClass(
  communityId: string | null,
  fromIso: string,
  toIso: string
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (classInstanceId: string) => {
      await fetch(`/api/classes/${classInstanceId}/register`, {
        method: "DELETE",
      });
    },
    onSuccess: () =>
      invalidateClassesAndEvents(qc, communityId, fromIso, toIso),
  });
}
