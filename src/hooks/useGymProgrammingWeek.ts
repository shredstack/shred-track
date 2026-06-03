// ---------------------------------------------------------------------------
// useGymProgrammingWeek — the single source of truth for editable week data.
//
// Both the week-editor (/gym/programming/[weekStart]) and the CrossFit-tab
// inline admin view consume this hook so a section saved on one surface
// shows up immediately on the other (same React Query key, same cache).
//
// Mutation paths (section create/update/reorder/delete, publish/unpublish)
// should invalidate this key via `gymProgrammingWeekKey()` rather than
// passing a parent-supplied refetch callback so both mount sites refresh
// without having to thread bookkeeping through the component tree.
// ---------------------------------------------------------------------------

"use client";

import { useQuery } from "@tanstack/react-query";
import type { WorkoutSectionKind } from "@/db/schema";

// Re-exported here so both mount sites can import from one place. Keeping
// these tied to the hook means a future API field addition is a single-file
// edit, not a hunt across two ~1.5k-line components.

export interface ProgrammingMovementWire {
  id: string;
  movementName: string;
  metricType: string;
  orderIndex: number;
  workoutBlockId: string | null;
  prescribedReps: string | null;
  prescribedWeightMale: string | null;
  prescribedWeightFemale: string | null;
  prescribedCaloriesMale: string | null;
  prescribedCaloriesFemale: string | null;
  prescribedDistanceMale: string | null;
  prescribedDistanceFemale: string | null;
  prescribedDurationSecondsMale: number | null;
  prescribedDurationSecondsFemale: number | null;
  prescribedHeightInches: string | null;
  prescribedHeightInchesMale: string | null;
  prescribedHeightInchesFemale: string | null;
  prescribedWeightMaleBwMultiplier: string | null;
  prescribedWeightFemaleBwMultiplier: string | null;
  prescribedWeightPct: string | null;
  tempo: string | null;
  isMaxReps: boolean;
  captureDurationPerRound: boolean;
  isSideCadence: boolean;
  equipmentCount: number | null;
}

export interface ProgrammingPartWire {
  id: string;
  label: string | null;
  orderIndex: number;
  notes: string | null;
  workoutType: string;
  timeCapSeconds: number | null;
  amrapDurationSeconds: number | null;
  emomIntervalSeconds: number | null;
  intervalWorkSeconds: number | null;
  intervalRestSeconds: number | null;
  intervalRounds: unknown;
  sideCadenceIntervalSeconds: number | null;
  sideCadenceOpenEnded: boolean;
  repScheme: string | null;
  rounds: number | null;
  structure: string | null;
  blocks: { id: string; orderIndex: number; title: string }[];
  movements: ProgrammingMovementWire[];
}

export interface ProgrammingSectionWire {
  id: string;
  kind: WorkoutSectionKind;
  subKind: string | null;
  position: number;
  title: string | null;
  body: string | null;
  notes?: string | null;
  isScored: boolean;
  scoreType: string | null;
  reviewedAt: string | null;
  sourceTrackId: string | null;
  // Count of athlete scores currently logged against this section.
  // Drives the "X athletes have already scored…" confirmation when a coach
  // edits or deletes a section that members have already used. Always
  // returned by the API (zero when unscored or no logs yet) — the optional
  // marker is defensive against a stale persisted cache that may briefly
  // restore a pre-field shape on first paint.
  scoreCount?: number;
  parts: ProgrammingPartWire[];
}

export interface ProgrammingWorkoutWire {
  id: string;
  title: string | null;
  description: string | null;
  workoutDate: string;
  workoutType: string | null;
  programmingReleaseId: string | null;
  reviewedAt: string | null;
  sections: ProgrammingSectionWire[];
  partsWithoutSection: ProgrammingPartWire[];
}

export interface ProgrammingWeekRelease {
  id: string;
  status: "draft" | "published";
  publishedAt: string | null;
  source: string;
}

export interface GymProgrammingWeekData {
  weekStart: string;
  release: ProgrammingWeekRelease | null;
  workouts: ProgrammingWorkoutWire[];
}

/**
 * Stable React Query key for the editable week payload. Exported so
 * mutation paths can invalidate it without copy-pasting the tuple.
 *
 * Why this exact shape: the ProgrammingWeekHeader subscribes to
 * `["gym", communityId, "programming-nav", weekStart]` for the surrounding-
 * week status strip, and the week-view has historically used
 * `["gym", communityId, "programming", weekStart]`. Keeping both within the
 * `["gym", communityId, ...]` namespace lets a coarse invalidation by
 * `["gym", communityId]` refresh everything in one call when that's useful.
 */
export function gymProgrammingWeekKey(
  communityId: string,
  weekStart: string
): readonly unknown[] {
  return ["gym", communityId, "programming", weekStart];
}

export function useGymProgrammingWeek(
  communityId: string | null,
  weekStart: string | null
) {
  return useQuery<GymProgrammingWeekData>({
    queryKey: gymProgrammingWeekKey(communityId ?? "_", weekStart ?? "_"),
    enabled: !!communityId && !!weekStart,
    queryFn: async () => {
      const res = await fetch(
        `/api/gym/${communityId}/programming?weekStart=${weekStart}`
      );
      if (!res.ok) throw new Error("Failed to load programming week");
      return res.json();
    },
  });
}
