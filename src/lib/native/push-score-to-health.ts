"use client";

// ============================================================
// Push a saved score to Apple Health.
// ============================================================
//
// Called from the score-entry success path. No-ops on web / non-iOS / when
// the user has disabled the push pref. The server holds the authoritative
// kcal numbers; we just relay them to HealthKit and stash the resulting
// HK UUID server-side for idempotency.

import {
  HK_ACTIVITY_TYPE,
  deleteHealthKitWorkout,
  healthKitHasOverlappingWorkout,
  isHealthKitAvailable,
  requestHealthKitWritePermission,
  saveHealthKitWorkout,
} from "./healthkit-timer";

// Synthetic UUID we stash server-side when an Apple Watch workout already
// overlapped the score's bracket — there's no HK record for us to delete.
const APPLE_WATCH_OVERLAP_SENTINEL = "00000000-0000-0000-0000-000000000000";

export interface PushScoreInput {
  scoreId: string;
  workoutType?: string;
  /** Start / end as ms since epoch. Caller resolves these from score.startedAt
   *  / endedAt — or falls back to "now - durationSeconds" if a live bracket
   *  isn't available. */
  fromMs: number;
  toMs: number;
  /** EPOC-applied active energy. The same number our app displays so the Move
   *  ring matches our number. */
  activeEnergyKcal: number;
  pushPrefEnabled: boolean;
  /** Server-built HKWorkout metadata: WOD title, format, movements, score
   *  text, RPE, notes, etc. Apple Health renders these in the workout detail
   *  view; some third-party readers (Oura, etc.) may also surface them. */
  metadata?: Record<string, string | number>;
  /** When set, this is a re-push after a score edit. We delete the previous
   *  HK workout first (HK records are immutable) and tell the server to
   *  overwrite its stored UUID. The sentinel "all-zeros" UUID signals an
   *  Apple Watch overlap on the original push — no HK row to delete. */
  existingWorkoutUuid?: string | null;
}

function activityTypeFor(workoutType?: string): number {
  switch (workoutType) {
    case "for_load":
    case "max_effort":
      return HK_ACTIVITY_TYPE.functionalStrengthTraining;
    default:
      return HK_ACTIVITY_TYPE.highIntensityIntervalTraining;
  }
}

export async function pushScoreToAppleHealth(
  input: PushScoreInput
): Promise<{
  status: "ok" | "updated" | "skipped" | "overlap" | "denied" | "unavailable";
}> {
  if (!input.pushPrefEnabled) return { status: "skipped" };
  if (!isHealthKitAvailable()) return { status: "unavailable" };
  if (input.activeEnergyKcal <= 0) return { status: "skipped" };
  if (input.toMs <= input.fromMs) return { status: "skipped" };

  // Permission gate. Requests on first save after install; on subsequent
  // saves Apple short-circuits if already granted.
  const granted = await requestHealthKitWritePermission();
  if (!granted) return { status: "denied" };

  // Edit case: previous push wrote an HK record (or hit the Watch-overlap
  // sentinel). HK records are immutable, so to reflect the edit we delete
  // the old one before writing a fresh one.
  const isReplace = Boolean(input.existingWorkoutUuid);
  const priorRealUuid =
    input.existingWorkoutUuid &&
    input.existingWorkoutUuid !== APPLE_WATCH_OVERLAP_SENTINEL
      ? input.existingWorkoutUuid
      : null;

  // Apple Watch double-count guard. Check overlap BEFORE deleting our prior
  // record — otherwise an Apple Watch workout that appeared after the original
  // push would be detected as an overlap, we'd bail, and the user would be
  // left with neither the old ShredTrack record nor a new one. Exclude our
  // own prior UUID so it doesn't self-overlap.
  const overlap = await healthKitHasOverlappingWorkout(
    input.fromMs,
    input.toMs,
    priorRealUuid ?? undefined,
  );
  if (overlap) {
    await fetch(`/api/scores/${input.scoreId}/push-to-apple-health`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // We still call the endpoint so the score-source flag flips, but with
        // a synthetic UUID telling the server it was an overlap skip.
        workoutUuid: APPLE_WATCH_OVERLAP_SENTINEL,
        source: "apple_health_user",
        replace: isReplace,
      }),
    }).catch(() => null);
    return { status: "overlap" };
  }

  // Safe to delete the old record now that we know we'll be writing a fresh
  // one (no Apple Watch overlap blocking us).
  if (priorRealUuid) {
    await deleteHealthKitWorkout(priorRealUuid);
  }

  const uuid = await saveHealthKitWorkout({
    fromMs: input.fromMs,
    toMs: input.toMs,
    activeEnergyKcal: input.activeEnergyKcal,
    activityType: activityTypeFor(input.workoutType),
    metadata: input.metadata,
  });
  if (!uuid) return { status: "denied" };

  await fetch(`/api/scores/${input.scoreId}/push-to-apple-health`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workoutUuid: uuid,
      source: "model",
      replace: isReplace,
    }),
  }).catch(() => null);
  return { status: isReplace ? "updated" : "ok" };
}
