// Centralized client hooks for the Custom Tracks v2 feature (spec §4.1).
//
// React Query is the single source of truth for client-side track state.
// Mutations invalidate the relevant keys in onSuccess.

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ProgressionDayOutput,
  ProgressionInput,
} from "@/lib/programming/progression-generator";
import type {
  TrackDayUpsertInput,
  TrackScoringConfig,
} from "@/types/programming-tracks";

export interface TrackRow {
  id: string;
  communityId: string;
  kind: string;
  name: string;
  description: string | null;
  startsOn: string;
  endsOn: string;
  displayMode: string;
  inlinePosition: string | null;
  optInRequired: boolean;
  scoringConfig: TrackScoringConfig | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrackDayRow {
  id: string;
  trackId: string;
  date: string;
  body: string | null;
  // Legacy column (always null for unified-schema writes). Kept on the
  // type because the GET endpoint still returns it.
  workoutId: string | null;
  // Unified-schema link to workout_sessions.id — this is what new writes
  // (smart builder, progression generator, publish injector) populate.
  workoutSessionId: string | null;
  isScored: boolean;
  scoreType: string | null;
}

// ============================================
// List tracks
// ============================================

export function useTracksList(communityId: string | null) {
  return useQuery<{ tracks: TrackRow[] }>({
    queryKey: ["gym", communityId, "tracks"],
    enabled: !!communityId,
    queryFn: async () => {
      const res = await fetch(`/api/gym/${communityId}/tracks`);
      if (!res.ok) throw new Error("Failed to load tracks");
      return res.json();
    },
  });
}

// ============================================
// Single track + days
// ============================================

export function useTrack(communityId: string | null, trackId: string | null) {
  return useQuery<{ track: TrackRow; days: TrackDayRow[] }>({
    queryKey: ["gym", communityId, "tracks", trackId],
    enabled: !!communityId && !!trackId,
    queryFn: async () => {
      const res = await fetch(
        `/api/gym/${communityId}/tracks/${trackId}`
      );
      if (!res.ok) throw new Error("Failed to load track");
      return res.json();
    },
  });
}

export function useUpdateTrack(communityId: string, trackId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<TrackRow>) => {
      const res = await fetch(
        `/api/gym/${communityId}/tracks/${trackId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed to update");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["gym", communityId, "tracks", trackId],
      });
      qc.invalidateQueries({ queryKey: ["gym", communityId, "tracks"] });
    },
  });
}

export function useDeleteTrack(communityId: string, trackId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/gym/${communityId}/tracks/${trackId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed to delete");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gym", communityId, "tracks"] });
    },
  });
}

// ============================================
// Track days
// ============================================

export function useTrackDayUpsert(communityId: string, trackId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      date: string;
      input: TrackDayUpsertInput;
    }) => {
      const res = await fetch(
        `/api/gym/${communityId}/tracks/${trackId}/days/${params.date}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params.input),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed to save day");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["gym", communityId, "tracks", trackId],
      });
    },
  });
}

export function useTrackDayDelete(communityId: string, trackId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (date: string) => {
      const res = await fetch(
        `/api/gym/${communityId}/tracks/${trackId}/days/${date}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed to delete day");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["gym", communityId, "tracks", trackId],
      });
    },
  });
}

export function useTrackDayCreateWorkout(
  communityId: string,
  trackId: string
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      date: string;
      // builderPartToPayload[] output, shaped like POST /api/workouts parts
      title?: string;
      parts: unknown[];
    }) => {
      const res = await fetch(
        `/api/gym/${communityId}/tracks/${trackId}/days/${params.date}/workout`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed to create workout");
      }
      return res.json() as Promise<{
        workoutId: string;
        trackDayId: string;
      }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["gym", communityId, "tracks", trackId],
      });
    },
  });
}

// ============================================
// Progression generator
// ============================================

export function useGenerateProgression(
  communityId: string,
  trackId: string
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: Omit<ProgressionInput, "startsOn" | "endsOn"> & {
        overwriteReviewed?: boolean;
      }
    ) => {
      const res = await fetch(
        `/api/gym/${communityId}/tracks/${trackId}/generate-progression`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed to generate");
      }
      return res.json() as Promise<{ generated: number; skipped: number }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["gym", communityId, "tracks", trackId],
      });
    },
  });
}

// ============================================
// Monthly Challenge Builder (spec §5.1)
// ============================================

export interface BuilderSeedPayload {
  pattern:
    | { kind: "flat"; dailyAmount: number }
    | {
        kind: "ladder";
        startAmount: number;
        incrementPerDay: number;
        weeklyBonus?: number;
      }
    | {
        kind: "per_day";
        daysSets: Array<{ date: string; sets: number[]; restHint?: string }>;
      };
  unit: string;
  unitLabel?: string;
  label: string;
  restCadence: "none" | "every_7th" | "weekends";
  restDayLabel?: string;
  markDoneStyle: "prefilled" | "free_entry" | "checkbox";
  aggregation: "sum" | "streak" | "last" | "per_day_independent";
  description?: string;
  dailyTarget?: number;
}

export function useSeedFromBuilder(communityId: string, trackId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: BuilderSeedPayload) => {
      const res = await fetch(
        `/api/gym/${communityId}/tracks/${trackId}/seed-from-builder`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed to seed challenge");
      }
      return res.json() as Promise<{
        written: number;
        scoringConfig: TrackScoringConfig;
      }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["gym", communityId, "tracks", trackId],
      });
      qc.invalidateQueries({ queryKey: ["gym", communityId, "tracks"] });
    },
  });
}

// ============================================
// Athlete: available tracks + participations
// ============================================

export interface AvailableTrack {
  id: string;
  name: string;
  kind: string;
  description: string | null;
  startsOn: string;
  endsOn: string;
  displayMode: string;
  inlinePosition: string | null;
  scoringConfig: TrackScoringConfig | null;
  isJoined: boolean;
  memberCount: number;
}

export function useAvailableTracks(communityId: string | null) {
  return useQuery<{ tracks: AvailableTrack[] }>({
    queryKey: ["available-tracks", communityId],
    enabled: !!communityId,
    queryFn: async () => {
      const res = await fetch(`/api/gym/${communityId}/tracks/available`);
      if (!res.ok) throw new Error("Failed to load tracks");
      return res.json();
    },
  });
}

export function useTrackParticipation(
  communityId: string | null,
  trackId: string | null
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (action: "join" | "leave") => {
      const res = await fetch(
        `/api/gym/${communityId}/tracks/${trackId}/participations`,
        { method: action === "join" ? "POST" : "DELETE" }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["available-tracks", communityId] });
      qc.invalidateQueries({ queryKey: ["me", "track-days"] });
    },
  });
}

// ============================================
// Athlete: opted-in track days for today
// ============================================

export interface MyTrackDay {
  trackDayId: string;
  trackId: string;
  trackName: string;
  kind: string;
  displayMode: string;
  dayNumber: number;
  inlinePosition: string | null;
  body: string | null;
  workoutId: string | null;
  isScored: boolean;
  scoreType: string | null;
  scoringConfig: TrackScoringConfig | null;
  /** Auto-fill value for "Mark done" (e.g. 40 from "40 sit-ups"). */
  prescribedValue: number | null;
}

export function useMyTrackDays(
  communityId: string | null,
  date: string | null
) {
  return useQuery<{ trackDays: MyTrackDay[] }>({
    queryKey: ["me", "track-days", communityId, date],
    enabled: !!communityId && !!date,
    queryFn: async () => {
      const url = new URL(
        "/api/me/track-days",
        typeof window !== "undefined" ? window.location.origin : "http://localhost"
      );
      url.searchParams.set("date", date!);
      url.searchParams.set("communityId", communityId!);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });
}

// ============================================
// Track day scores (per-day numeric input)
// ============================================

export interface TrackDayScore {
  id: string;
  trackDayId: string;
  userId: string;
  numericValue: string | null;
  textValue: string | null;
  unit: string | null;
  isComplete: boolean;
  notes: string | null;
}

export function useTrackDayScore(trackDayId: string | null) {
  return useQuery<{ score: TrackDayScore | null }>({
    queryKey: ["track-day-score", trackDayId],
    enabled: !!trackDayId,
    queryFn: async () => {
      const res = await fetch(`/api/track-days/${trackDayId}/score`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });
}

export function useUpsertTrackDayScore(trackDayId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      numericValue?: number | null;
      textValue?: string | null;
      isComplete?: boolean;
      notes?: string | null;
    }) => {
      const res = await fetch(`/api/track-days/${trackDayId}/score`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["track-day-score", trackDayId] });
      qc.invalidateQueries({ queryKey: ["track-day-rollup", trackDayId] });
    },
  });
}

export function useDeleteTrackDayScore(trackDayId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/track-days/${trackDayId}/score`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["track-day-score", trackDayId] });
      qc.invalidateQueries({ queryKey: ["track-day-rollup", trackDayId] });
    },
  });
}

export interface TrackDayRollup {
  today: { numericValue: number | null; isComplete: boolean };
  sum: number;
  daysLogged: number;
  daysAvailable: number;
  aggregation: "sum" | "last" | "per_day_independent" | "streak";
  /** True when scores roll up across the whole track (monthly_challenge
   *  or aggregation === "sum"). Use this — not `aggregation` — to decide
   *  whether to surface cumulative totals in the UI. */
  isCumulative: boolean;
  dailyTarget: number | null;
  unit: string | null;
  unitLabel: string | null;
}

export function useTrackDayRollup(trackDayId: string | null) {
  return useQuery<TrackDayRollup>({
    queryKey: ["track-day-rollup", trackDayId],
    enabled: !!trackDayId,
    queryFn: async () => {
      const res = await fetch(`/api/track-days/${trackDayId}/rollup`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });
}

// ============================================
// Track day leaderboard (gym-scoped ranking)
// ============================================

export interface TrackDayLeaderboardEntry {
  scoreId: string;
  userId: string;
  userName: string;
  userUsername: string | null;
  userImage: string | null;
  numericValue: number | null;
  unit: string | null;
  isComplete: boolean;
  notes: string | null;
  createdAt: string;
  displayScore: string;
  sortValue: number;
  /** For cumulative leaderboards, number of days the athlete has logged. */
  daysLogged?: number;
  /** Longest run of consecutive scored days the athlete has completed. */
  consecutiveDaysLogged?: number;
  /** daysLogged / daysAvailable ratio (0..1, rounded to 2 decimals). */
  adherence?: number;
}

export interface TrackDayLeaderboardResponse {
  trackName: string;
  trackKind: string;
  dayDate: string;
  unitLabel: string | null;
  /** True when the response sums each athlete's scores across the whole track. */
  isCumulative: boolean;
  /** Total scored days in the parent track. */
  daysAvailable?: number;
  /** When "streak", rank is by daysLogged rather than sum(numericValue). */
  rankKey: "sum" | "streak";
  entries: TrackDayLeaderboardEntry[];
}

export function useTrackDayLeaderboard(
  trackDayId: string | null,
  options?: { enabled?: boolean }
) {
  return useQuery<TrackDayLeaderboardResponse>({
    queryKey: ["track-day-leaderboard", trackDayId],
    enabled: !!trackDayId && (options?.enabled ?? true),
    queryFn: async () => {
      const res = await fetch(`/api/track-days/${trackDayId}/leaderboard`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to load leaderboard");
      }
      return res.json();
    },
    // Same cadence as the workout leaderboard for a real-time-ish feel.
    refetchInterval: 30_000,
  });
}
