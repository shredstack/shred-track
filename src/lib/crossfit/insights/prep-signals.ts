// ============================================
// Notes Insights v2 — workout-detail prep card
// ============================================
//
// Powers the "Last time you did this" stretch-goal list and the
// anticipatory complaint banner rendered above the score-entry area on
// the workout detail card. See
// claude_code_instructions/crossfit_improvements/notes_insights_v2_spec.md
// §2.1 and §2.2.
//
// Pure helpers (`proposeStretchGoal`, `pickRecentBest`) live alongside the
// DB-bound entry (`getWorkoutPrepSignals`) so the math is unit-testable
// without standing up a database.

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  crossfitWorkoutMovements,
  movements,
  scoreMovementSignals,
  scoreNotesExtractions,
  scores,
  workoutSessions,
} from "@/db/schema";
import type {
  NotesComplaint,
  NotesPerformanceMetric,
} from "@/types/crossfit";

// ============================================
// Tunables
// ============================================

const WINDOW_DAYS = 90;
const MAX_COMPLAINT_BANNERS = 2;
const COMPLAINT_MIN_CONFIDENCE = 0.5;

// reps_in_window / unbroken_reps: cap the proposed value so we don't tell a
// world-class athlete "stretch goal: 230 DUs."
const REPS_STRETCH_MULTIPLIER = 1.15;
const REPS_STRETCH_MAX_DELTA = 25; // never propose more than +25 reps over best
const REPS_STRETCH_ABSOLUTE_CAP = 200;

// pace / set_split: 5–10% faster pace, but skip if the athlete is already
// flying. Threshold is per-rep / per-window seconds — anything under 30s
// is "sprint territory" and a stretch goal is noise.
const PACE_STRETCH_MULTIPLIER = 0.93; // ~7% faster
const PACE_SKIP_UNDER_SECONDS = 30;

// ============================================
// Public types
// ============================================

export type StretchGoalSignal = {
  movement: string; // canonical-ish movement name as the LLM emitted it
  metric: NotesPerformanceMetric;
  bestValue: number;
  bestUnit: string;
  bestWindow: string | null;
  bestPhrase: string;
  bestWorkoutDate: string; // YYYY-MM-DD
  stretchValue: number;
  stretchUnit: string;
};

export type ComplaintBanner = {
  movement: string; // canonical-ish movement name from the complaint
  topic: string;
  phrase: string;
  workoutDate: string; // YYYY-MM-DD
  recommendation: string | null; // static-map lookup; null when unknown topic
};

export type WorkoutPrepSignals = {
  stretchGoals: StretchGoalSignal[];
  complaintBanners: ComplaintBanner[];
};

// One row out of `score_movement_signals` shaped for the in-process picker.
export type MovementSignalRow = {
  scoreId: string;
  movementName: string;
  metric: NotesPerformanceMetric;
  value: number;
  unit: string;
  window: string | null;
  qualitative: "better" | "same" | "worse" | null;
  phrase: string;
  workoutDate: string;
};

// ============================================
// Pure helpers
// ============================================

// Topic → static recommendation. Spec §2.2: keep it small, predictable, no
// LLM at render time. Unknown topics render the verbatim phrase only.
//
// Keys are lowercase, trim()'d topics as emitted by the extraction LLM
// (`NotesComplaint.topic` is already normalized to lower-case).
const COMPLAINT_RECOMMENDATIONS: Record<string, string> = {
  grip: "Consider a hook grip or breaking the set sooner.",
  "shoulder fatigue": "Save volume on overhead work.",
  shoulder: "Pace overhead reps and break sets before failure.",
  "shoulder strength": "Drop the load if shoulders fatigue mid-set.",
  "low back": "Brace hard on hinge movements and watch your set length.",
  hip: "Add an extra warm-up set to open the hips.",
  endurance: "Pace the first round conservatively.",
  "arm strength": "Consider scaling the load so you can stay unbroken.",
};

export function recommendationForTopic(topic: string): string | null {
  return COMPLAINT_RECOMMENDATIONS[topic.trim().toLowerCase()] ?? null;
}

// `pace` and `set_split` are time bounds (smaller = faster); every other
// metric is higher-is-better. The picker flips its comparator off this set.
const LOWER_IS_BETTER: ReadonlySet<NotesPerformanceMetric> = new Set([
  "pace",
  "set_split",
]);

// Pick the "recent best" signal per (movement, metric) from a row list.
// Splits by metric because a "pace" best and a "reps_in_window" best on the
// same movement are different stretch goals and should both render.
export function pickRecentBests(
  rows: MovementSignalRow[]
): MovementSignalRow[] {
  const byKey = new Map<string, MovementSignalRow>();
  for (const r of rows) {
    const key = `${r.movementName.toLowerCase()}::${r.metric}`;
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, r);
      continue;
    }
    if (LOWER_IS_BETTER.has(r.metric)) {
      if (r.value < cur.value) byKey.set(key, r);
    } else {
      // Default to higher-is-better when we don't recognize the metric.
      if (r.value > cur.value) byKey.set(key, r);
    }
  }
  return Array.from(byKey.values());
}

// Returns the stretch-goal payload for one signal, or null when the
// metric should be skipped (load_for_reps, sub-threshold pace, etc.).
// Pure — exported for direct unit testing per §5 PR 2.
export function proposeStretchGoal(signal: {
  metric: NotesPerformanceMetric;
  value: number;
  unit: string;
}): { value: number; unit: string } | null {
  switch (signal.metric) {
    case "load_for_reps":
      // Owned by the 1RM Predictor (separate spec). Surfacing here would
      // double up the rec.
      return null;

    case "unbroken_reps":
    case "reps_in_window": {
      if (signal.value <= 0) return null;
      const raw = Math.ceil(signal.value * REPS_STRETCH_MULTIPLIER);
      const delta = Math.min(raw - signal.value, REPS_STRETCH_MAX_DELTA);
      const proposed = Math.min(
        signal.value + delta,
        REPS_STRETCH_ABSOLUTE_CAP
      );
      if (proposed <= signal.value) return null;
      return { value: proposed, unit: signal.unit };
    }

    case "pace":
    case "set_split": {
      // Skip if the value's already in sprint territory — proposing 5–10%
      // off a 28s split is noise.
      if (signal.value < PACE_SKIP_UNDER_SECONDS) return null;
      const proposed = Math.floor(signal.value * PACE_STRETCH_MULTIPLIER);
      if (proposed <= 0 || proposed >= signal.value) return null;
      return { value: proposed, unit: signal.unit };
    }

    default:
      return null;
  }
}

// Per spec §2.2: cap banners at 2, prefer the most recent. Pure so the
// dedupe + cap is unit-testable.
export function shapeComplaintBanners(
  complaints: Array<{
    movement: string;
    topic: string;
    phrase: string;
    workoutDate: string;
  }>,
  cap = MAX_COMPLAINT_BANNERS
): ComplaintBanner[] {
  // Dedupe by (movement, topic) — same complaint mentioned twice across
  // sessions shouldn't fill both slots.
  const byKey = new Map<string, ComplaintBanner>();
  for (const c of complaints) {
    const key = `${c.movement.toLowerCase()}::${c.topic.toLowerCase()}`;
    const cur = byKey.get(key);
    if (!cur || c.workoutDate > cur.workoutDate) {
      byKey.set(key, {
        movement: c.movement,
        topic: c.topic,
        phrase: c.phrase,
        workoutDate: c.workoutDate,
        recommendation: recommendationForTopic(c.topic),
      });
    }
  }
  return Array.from(byKey.values())
    .sort((a, b) => b.workoutDate.localeCompare(a.workoutDate))
    .slice(0, cap);
}

// ============================================
// DB-bound entries
// ============================================

function daysAgoIso(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// Read-side query against `score_movement_signals`. Exported per spec §7
// so the same lookup can power score-entry surfaces in PR 3 without
// re-implementing the case-insensitive name match.
export async function selectMovementSignalsForPrep(
  userId: string,
  movementNames: string[]
): Promise<MovementSignalRow[]> {
  if (movementNames.length === 0) return [];
  const since = daysAgoIso(WINDOW_DAYS);
  const lowered = movementNames.map((n) => n.toLowerCase());

  const rows = await db
    .select({
      scoreId: scoreMovementSignals.scoreId,
      movementName: scoreMovementSignals.movementName,
      metric: scoreMovementSignals.metric,
      value: scoreMovementSignals.value,
      unit: scoreMovementSignals.unit,
      window: scoreMovementSignals.window,
      qualitative: scoreMovementSignals.qualitative,
      phrase: scoreMovementSignals.phrase,
      workoutDate: scoreMovementSignals.workoutDate,
    })
    .from(scoreMovementSignals)
    .where(
      and(
        eq(scoreMovementSignals.userId, userId),
        gte(scoreMovementSignals.workoutDate, since),
        // ANY against a text[] hits the
        // (user_id, lower(movement_name), workout_date desc) index.
        sql`lower(${scoreMovementSignals.movementName}) = ANY(${lowered})`
      )
    )
    .orderBy(desc(scoreMovementSignals.workoutDate));

  return rows.map((r) => ({
    scoreId: r.scoreId,
    movementName: r.movementName,
    metric: r.metric as NotesPerformanceMetric,
    value: Number(r.value),
    unit: r.unit,
    window: r.window,
    qualitative: r.qualitative as "better" | "same" | "worse" | null,
    phrase: r.phrase,
    workoutDate: r.workoutDate,
  }));
}

// Loads the canonical movement names for a workout session by resolving
// it to its template (`crossfit_workout_id`) and reading
// `crossfit_workout_movements`. Returns [] for freeform sessions (no
// linked template) or unknown ids — the prep card hides itself in both
// cases.
async function loadMovementNamesForSession(
  workoutSessionId: string
): Promise<string[]> {
  const [session] = await db
    .select({ crossfitWorkoutId: workoutSessions.crossfitWorkoutId })
    .from(workoutSessions)
    .where(eq(workoutSessions.id, workoutSessionId))
    .limit(1);
  if (!session?.crossfitWorkoutId) return [];

  const rows = await db
    .selectDistinct({ name: movements.canonicalName })
    .from(crossfitWorkoutMovements)
    .innerJoin(movements, eq(movements.id, crossfitWorkoutMovements.movementId))
    .where(
      eq(crossfitWorkoutMovements.crossfitWorkoutId, session.crossfitWorkoutId)
    );
  return rows.map((r) => r.name);
}

// Pulls movement-attributed complaints in the last 90 days for the given
// user, then filters down to complaints whose `movement` matches one of
// the workout's movements (case-insensitive). Returns the most-recent
// instance per (movement, topic) for the caller to cap/sort.
async function loadMovementComplaintsForUser(
  userId: string,
  workoutMovementNames: string[]
): Promise<
  Array<{
    movement: string;
    topic: string;
    phrase: string;
    workoutDate: string;
  }>
> {
  if (workoutMovementNames.length === 0) return [];
  const since = daysAgoIso(WINDOW_DAYS);
  const workoutMovementSet = new Set(
    workoutMovementNames.map((n) => n.toLowerCase())
  );

  const rows = await db
    .select({
      complaints: scoreNotesExtractions.complaints,
      workoutDate: workoutSessions.workoutDate,
    })
    .from(scoreNotesExtractions)
    .innerJoin(scores, eq(scores.id, scoreNotesExtractions.scoreId))
    .innerJoin(
      workoutSessions,
      eq(workoutSessions.id, scores.workoutSessionId)
    )
    .where(
      and(eq(scores.userId, userId), gte(workoutSessions.workoutDate, since))
    );

  const out: Array<{
    movement: string;
    topic: string;
    phrase: string;
    workoutDate: string;
  }> = [];
  for (const r of rows) {
    for (const c of (r.complaints ?? []) as NotesComplaint[]) {
      if (!c.movement) continue;
      if (c.confidence < COMPLAINT_MIN_CONFIDENCE) continue;
      if (!workoutMovementSet.has(c.movement.toLowerCase())) continue;
      out.push({
        movement: c.movement,
        topic: c.topic,
        phrase: c.phrase,
        workoutDate: r.workoutDate,
      });
    }
  }
  return out;
}

export async function getWorkoutPrepSignals(input: {
  userId: string;
  workoutId: string;
}): Promise<WorkoutPrepSignals> {
  const movementNames = await loadMovementNamesForSession(input.workoutId);
  if (movementNames.length === 0) {
    return { stretchGoals: [], complaintBanners: [] };
  }

  const [signalRows, rawBanners] = await Promise.all([
    selectMovementSignalsForPrep(input.userId, movementNames),
    loadMovementComplaintsForUser(input.userId, movementNames),
  ]);

  const bests = pickRecentBests(signalRows);
  const stretchGoals: StretchGoalSignal[] = [];
  for (const best of bests) {
    const proposed = proposeStretchGoal({
      metric: best.metric,
      value: best.value,
      unit: best.unit,
    });
    if (!proposed) continue;
    stretchGoals.push({
      movement: best.movementName,
      metric: best.metric,
      bestValue: best.value,
      bestUnit: best.unit,
      bestWindow: best.window,
      bestPhrase: best.phrase,
      bestWorkoutDate: best.workoutDate,
      stretchValue: proposed.value,
      stretchUnit: proposed.unit,
    });
  }
  // Most-recent best first so the freshest signal is at the top of the card.
  stretchGoals.sort((a, b) =>
    b.bestWorkoutDate.localeCompare(a.bestWorkoutDate)
  );

  return {
    stretchGoals,
    complaintBanners: shapeComplaintBanners(rawBanners),
  };
}
