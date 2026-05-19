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
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["gym", communityId, "classes", fromIso, toIso],
      });
    },
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
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["gym", communityId, "classes", fromIso, toIso],
      });
    },
  });
}
