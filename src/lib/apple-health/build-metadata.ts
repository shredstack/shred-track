// Build the HKWorkout metadata dictionary attached to scores we push to
// Apple Health. Server-side only — runs after a score insert/update so the
// dict can travel back to the iOS client and into the HKWorkout via
// `HKWorkoutBuilder.addMetadata(...)`.
//
// Values are restricted to string | number so the Capacitor bridge can
// serialize them; the Swift side maps them to `NSString` / `NSNumber` for
// HealthKit. Apple-defined keys (HKMetadataKey*) are surfaced more nicely in
// the Health app; custom `ShredTrack.*` keys are still visible in the
// workout detail view and let third-party apps (Oura, etc.) read them if
// they choose to.

import { db } from "@/db";
import { asc, eq, inArray } from "drizzle-orm";
import {
  crossfitWorkoutMovements,
  crossfitWorkoutParts,
  crossfitWorkouts,
  movements as movementsTable,
  scores,
  workoutSessions,
} from "@/db/schema";
import { WORKOUT_TYPE_LABELS, type WorkoutType } from "@/types/crossfit";

// HK metadata only accepts NSString / NSNumber / NSDate / HKQuantity. We
// JSON-serialize across the bridge, so the JS shape is string | number.
export type AppleHealthMetadata = Record<string, string | number>;

// Apple-published metadata key. Some third-party apps surface this as the
// "source" of a workout.
const HK_METADATA_KEY_WORKOUT_BRAND_NAME = "HKMetadataKeyWorkoutBrandName";

// Cap individual value lengths so a pathological WOD description (huge notes,
// dozens of movements) can't blow past HealthKit's per-value limits.
const MAX_VALUE_LENGTH = 1024;

function truncate(s: string): string {
  return s.length > MAX_VALUE_LENGTH ? s.slice(0, MAX_VALUE_LENGTH - 1) + "…" : s;
}

function formatMinSec(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDuration(totalSeconds: number): string {
  return totalSeconds % 60 === 0
    ? `${totalSeconds / 60} min`
    : formatMinSec(totalSeconds);
}

interface PartShape {
  workoutType: string;
  timeCapSeconds: number | null;
  amrapDurationSeconds: number | null;
  emomIntervalSeconds: number | null;
  repScheme: string | null;
  rounds: number | null;
  label: string | null;
  notes: string | null;
}

function formatWorkoutFormat(part: PartShape): string {
  const typeLabel =
    WORKOUT_TYPE_LABELS[part.workoutType as WorkoutType] ?? "Workout";
  if (part.workoutType === "amrap" && part.amrapDurationSeconds) {
    return `AMRAP ${formatDuration(part.amrapDurationSeconds)}`;
  }
  if (part.workoutType === "emom" && part.emomIntervalSeconds) {
    return `EMOM ${formatDuration(part.emomIntervalSeconds)}`;
  }
  if (part.timeCapSeconds) {
    return `${typeLabel} (${formatMinSec(part.timeCapSeconds)} cap)`;
  }
  if (part.rounds && part.rounds > 1) {
    return `${typeLabel} — ${part.rounds} rounds`;
  }
  return typeLabel;
}

interface MovementLine {
  name: string;
  prescribedReps: string | null;
  prescribedWeightMale: string | null;
  prescribedWeightFemale: string | null;
}

function formatMovementLine(m: MovementLine): string {
  const parts: string[] = [];
  if (m.prescribedReps && m.prescribedReps.trim()) {
    parts.push(`${m.prescribedReps.trim()} ${m.name}`);
  } else {
    parts.push(m.name);
  }
  const male = m.prescribedWeightMale ? Number(m.prescribedWeightMale) : null;
  const female = m.prescribedWeightFemale
    ? Number(m.prescribedWeightFemale)
    : null;
  if (male && female && male !== female) {
    parts.push(`@ ${male}/${female} lb`);
  } else if (male) {
    parts.push(`@ ${male} lb`);
  } else if (female) {
    parts.push(`@ ${female} lb`);
  }
  return parts.join(" ");
}

function formatScoreString(row: {
  workoutType: string;
  scoreText: string | null;
  timeSeconds: number | null;
  rounds: number | null;
  remainderReps: number | null;
  totalReps: number | null;
  weightLbs: string | null;
  hitTimeCap: boolean;
}): string | null {
  if (row.scoreText && row.scoreText.trim()) return row.scoreText.trim();
  switch (row.workoutType) {
    case "for_time": {
      if (row.timeSeconds == null) return null;
      const base = formatMinSec(row.timeSeconds);
      return row.hitTimeCap ? `${base} (capped)` : base;
    }
    case "amrap": {
      if (row.totalReps != null) return `${row.totalReps} reps`;
      if (row.rounds != null) {
        return `${row.rounds}+${row.remainderReps ?? 0}`;
      }
      return null;
    }
    case "for_load":
    case "max_effort":
      return row.weightLbs != null ? `${row.weightLbs} lb` : null;
    case "for_reps":
    case "for_calories":
    case "tabata":
      return row.totalReps != null ? `${row.totalReps} reps` : null;
    default:
      if (row.timeSeconds != null) return formatMinSec(row.timeSeconds);
      if (row.totalReps != null) return `${row.totalReps} reps`;
      if (row.weightLbs != null) return `${row.weightLbs} lb`;
      return null;
  }
}

/**
 * Build the HKWorkout metadata dictionary for a saved score. Returns null
 * when the score has no template attached (free-form / warmup sessions
 * can't be scored, but defensively we still skip), or when nothing useful
 * could be assembled.
 *
 * Safe to call from API routes — any DB failure throws, so wrap in try/catch
 * at the call site so the metadata build never blocks the score response.
 */
export async function buildAppleHealthMetadata(
  scoreId: string
): Promise<AppleHealthMetadata | null> {
  // Score + part + session join. The score row is the source of truth for
  // result fields (scoreText, timeSeconds, rpe, notes); the part carries
  // the workout-type + format; the session carries date and any title/body
  // overrides.
  const [row] = await db
    .select({
      score: scores,
      part: crossfitWorkoutParts,
      session: workoutSessions,
      workout: crossfitWorkouts,
    })
    .from(scores)
    .leftJoin(
      crossfitWorkoutParts,
      eq(scores.crossfitWorkoutPartId, crossfitWorkoutParts.id)
    )
    .leftJoin(
      workoutSessions,
      eq(scores.workoutSessionId, workoutSessions.id)
    )
    .leftJoin(
      crossfitWorkouts,
      eq(crossfitWorkoutParts.crossfitWorkoutId, crossfitWorkouts.id)
    )
    .where(eq(scores.id, scoreId))
    .limit(1);

  if (!row?.part || !row.workout) return null;

  // Per-part movements + canonical names.
  const movementRows = await db
    .select({
      orderIndex: crossfitWorkoutMovements.orderIndex,
      prescribedReps: crossfitWorkoutMovements.prescribedReps,
      prescribedWeightMale: crossfitWorkoutMovements.prescribedWeightMale,
      prescribedWeightFemale: crossfitWorkoutMovements.prescribedWeightFemale,
      movementId: crossfitWorkoutMovements.movementId,
    })
    .from(crossfitWorkoutMovements)
    .where(eq(crossfitWorkoutMovements.crossfitWorkoutPartId, row.part.id))
    .orderBy(asc(crossfitWorkoutMovements.orderIndex));

  const movementIds = movementRows.map((m) => m.movementId);
  const nameById = new Map<string, string>();
  if (movementIds.length > 0) {
    const names = await db
      .select({
        id: movementsTable.id,
        canonicalName: movementsTable.canonicalName,
      })
      .from(movementsTable)
      .where(inArray(movementsTable.id, movementIds));
    for (const n of names) nameById.set(n.id, n.canonicalName);
  }

  const meta: AppleHealthMetadata = {
    [HK_METADATA_KEY_WORKOUT_BRAND_NAME]: "ShredTrack",
  };

  // --- Title & date ---
  const title = (row.session?.title ?? row.workout.title)?.trim();
  if (title) meta["ShredTrack.WorkoutName"] = truncate(title);

  if (row.part.label && row.part.label.trim()) {
    meta["ShredTrack.PartLabel"] = truncate(row.part.label.trim());
  }

  if (row.session?.workoutDate) {
    // `date` columns come back as 'YYYY-MM-DD' strings.
    meta["ShredTrack.SessionDate"] = String(row.session.workoutDate);
  }

  // --- Format clause ("AMRAP 20 min", "For Time (10:00 cap)", etc.) ---
  meta["ShredTrack.WorkoutFormat"] = formatWorkoutFormat(row.part);

  // --- Description body: rep scheme + movement list ---
  const lines: string[] = [];
  if (row.part.repScheme && row.part.repScheme.trim()) {
    lines.push(`Rep Scheme: ${row.part.repScheme.trim()}`);
  }
  if (movementRows.length > 0) {
    for (const m of movementRows) {
      const name = nameById.get(m.movementId);
      if (!name) continue;
      lines.push(
        `• ${formatMovementLine({
          name,
          prescribedReps: m.prescribedReps,
          prescribedWeightMale: m.prescribedWeightMale,
          prescribedWeightFemale: m.prescribedWeightFemale,
        })}`
      );
    }
  }
  if (row.part.notes && row.part.notes.trim()) {
    lines.push("", `Notes: ${row.part.notes.trim()}`);
  } else if (row.session?.body && row.session.body.trim()) {
    lines.push("", row.session.body.trim());
  }
  if (lines.length > 0) {
    meta["ShredTrack.Description"] = truncate(lines.join("\n"));
  }

  // --- Score & athlete state ---
  const scoreStr = formatScoreString({
    workoutType: row.part.workoutType,
    scoreText: row.score.scoreText,
    timeSeconds: row.score.timeSeconds,
    rounds: row.score.rounds,
    remainderReps: row.score.remainderReps,
    totalReps: row.score.totalReps,
    weightLbs: row.score.weightLbs,
    hitTimeCap: row.score.hitTimeCap,
  });
  if (scoreStr) meta["ShredTrack.Score"] = truncate(scoreStr);

  if (row.score.division) {
    meta["ShredTrack.Division"] = String(row.score.division);
  }
  if (row.score.rpe != null) {
    meta["ShredTrack.RPE"] = row.score.rpe;
  }
  if (row.score.notes && row.score.notes.trim()) {
    meta["ShredTrack.Notes"] = truncate(row.score.notes.trim());
  }

  // --- Traceability ---
  meta["ShredTrack.ScoreId"] = row.score.id;
  if (row.session?.id) {
    meta["ShredTrack.WorkoutSessionId"] = row.session.id;
  }

  return meta;
}
