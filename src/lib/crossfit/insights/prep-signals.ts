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

import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  crossfitWorkoutMovements,
  crossfitWorkouts,
  movements,
  scoreMovementDetails,
  scoreMovementSignals,
  scoreNotesExtractions,
  scores,
  users,
  workoutSessions,
} from "@/db/schema";
import type {
  NotesComplaint,
  NotesPerformanceMetric,
} from "@/types/crossfit";
import type { PriorMovementContext } from "@/lib/crossfit/suggested-weight";

// ============================================
// Tunables
// ============================================

const WINDOW_DAYS = 90;
const MAX_COMPLAINT_BANNERS = 2;
const COMPLAINT_MIN_CONFIDENCE = 0.5;

// Movement-history section (notes_insights_v2_spec.md §4.2): at most 3
// entries per workout. Same 90-day window as the rest of the prep card.
const MAX_MOVEMENT_HISTORY = 3;
const MOVEMENT_HISTORY_WINDOW_DAYS = 90;

// Score-entry note prompt (Notes Insights v2 PR 3 §3.1). The nudge fires
// when the athlete has scaled a movement in today's workout at least this
// many times in the recent window — a signal that a note here would feed
// the graduation tracker.
const NUDGE_WINDOW_DAYS = 60;
const NUDGE_MIN_SCALES = 3;

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

// Score-entry note prompt (Notes Insights v2 PR 3 §3.1). One-line nudge
// surfaced above the notes textarea when the athlete has been quietly
// scaling a movement that's in today's workout. `scaleCount` is the
// number of distinct scaled scores in NUDGE_WINDOW_DAYS — drives the copy
// ("scaled 3× recently"). Client-side localStorage handles the per-movement
// 7-day cap.
export type NoteNudge = {
  movement: string; // canonical movement name from the catalog
  scaleCount: number;
  lastScaledAt: string; // YYYY-MM-DD — drives "most recent eligible movement" tie-breaking
};

// Movement-history prep card entry (notes_insights_v2_spec.md §4.2).
// One row per movement in today's workout that has a prior log on a
// different template. The side-by-side prescribed/actual context is
// non-negotiable copy — the athlete needs to read the comparison at a
// glance.
export type MovementHistoryEntry = {
  movementId: string;
  movementName: string; // canonical name from the catalog
  todayPrescribedLb: number | null;
  priorContext: PriorMovementContext;
};

export type WorkoutPrepSignals = {
  stretchGoals: StretchGoalSignal[];
  complaintBanners: ComplaintBanner[];
  // Notes Insights v2 PR 3 §3.1. Null when no movement in the workout
  // qualifies — the client renders nothing.
  noteNudge: NoteNudge | null;
  // Notes Insights v2 PR 4 §4.2. Empty when no eligible prior log — the
  // section self-hides.
  movementHistory: MovementHistoryEntry[];
};

// One eligible-scaled-movement candidate the picker walks. Exposed for the
// pure unit test in prep-signals.test.ts so the cap logic stays
// DB-independent.
export type NoteNudgeCandidate = {
  movement: string;
  scaleCount: number;
  lastScaledAt: string; // YYYY-MM-DD
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

// Picks the single nudge candidate to surface. Spec §3.1 caps the prompt
// to one per session and prefers the *most recent* eligible movement so
// the athlete sees the freshest pattern. Candidates with fewer than
// NUDGE_MIN_SCALES are filtered out (the picker doesn't trust the caller
// to enforce the floor). Pure for unit testability — the client cap (one
// per 7-day window per movement) lives in localStorage on the score-entry
// component.
export function pickNoteNudge(
  candidates: NoteNudgeCandidate[]
): NoteNudge | null {
  const eligible = candidates.filter((c) => c.scaleCount >= NUDGE_MIN_SCALES);
  if (eligible.length === 0) return null;
  // Sort by last-scaled date descending; on tie, higher scaleCount wins
  // (stronger signal).
  eligible.sort((a, b) => {
    const dateCmp = b.lastScaledAt.localeCompare(a.lastScaledAt);
    if (dateCmp !== 0) return dateCmp;
    return b.scaleCount - a.scaleCount;
  });
  const pick = eligible[0];
  return {
    movement: pick.movement,
    scaleCount: pick.scaleCount,
    lastScaledAt: pick.lastScaledAt,
  };
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

// Shape the workout-card needs to drive the movement-history section:
// per-movement template id + today's prescribed weights so the read-side
// joins know what to scale against.
type SessionTemplateMovement = {
  crossfitWorkoutId: string;
  movementId: string;
  movementName: string;
  prescribedWeightMale: number | null;
  prescribedWeightFemale: number | null;
};

async function loadSessionTemplateMovements(
  workoutSessionId: string
): Promise<{
  crossfitWorkoutId: string | null;
  movements: SessionTemplateMovement[];
}> {
  const [session] = await db
    .select({ crossfitWorkoutId: workoutSessions.crossfitWorkoutId })
    .from(workoutSessions)
    .where(eq(workoutSessions.id, workoutSessionId))
    .limit(1);
  if (!session?.crossfitWorkoutId) {
    return { crossfitWorkoutId: null, movements: [] };
  }

  const rows = await db
    .select({
      crossfitWorkoutId: crossfitWorkoutMovements.crossfitWorkoutId,
      movementId: crossfitWorkoutMovements.movementId,
      movementName: movements.canonicalName,
      prescribedWeightMale: crossfitWorkoutMovements.prescribedWeightMale,
      prescribedWeightFemale: crossfitWorkoutMovements.prescribedWeightFemale,
    })
    .from(crossfitWorkoutMovements)
    .innerJoin(movements, eq(movements.id, crossfitWorkoutMovements.movementId))
    .where(
      eq(crossfitWorkoutMovements.crossfitWorkoutId, session.crossfitWorkoutId)
    );

  // Multiple rows for the same movement collapse to one — we surface a
  // single line per movement and take the heaviest prescribed weight if
  // there's ambiguity (prevents a lightweight EMOM entry from masking a
  // heavy strength entry on the same template).
  const byMovement = new Map<string, SessionTemplateMovement>();
  for (const r of rows) {
    const cur = byMovement.get(r.movementId);
    const male = r.prescribedWeightMale != null ? Number(r.prescribedWeightMale) : null;
    const female =
      r.prescribedWeightFemale != null ? Number(r.prescribedWeightFemale) : null;
    if (!cur) {
      byMovement.set(r.movementId, {
        crossfitWorkoutId: r.crossfitWorkoutId,
        movementId: r.movementId,
        movementName: r.movementName,
        prescribedWeightMale: male,
        prescribedWeightFemale: female,
      });
      continue;
    }
    if (male != null && (cur.prescribedWeightMale == null || male > cur.prescribedWeightMale)) {
      cur.prescribedWeightMale = male;
    }
    if (
      female != null &&
      (cur.prescribedWeightFemale == null || female > cur.prescribedWeightFemale)
    ) {
      cur.prescribedWeightFemale = female;
    }
  }
  return {
    crossfitWorkoutId: session.crossfitWorkoutId,
    movements: Array.from(byMovement.values()),
  };
}

// Heaviest representative weight from a setEntries blob, mirroring the
// suggested-weight engine's logic so the prep card surfaces the same
// "worked up to" number as the chip's anchor.
function representativeFromSetEntries(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setEntries: any[] | null | undefined,
  actualWeight: number | null
): number | null {
  if (Array.isArray(setEntries) && setEntries.length > 0) {
    let max = 0;
    for (const e of setEntries) {
      const w = Number(e?.weight);
      if (Number.isFinite(w) && w > max) max = w;
    }
    if (max > 0) return max;
  }
  if (actualWeight != null && actualWeight > 0) return actualWeight;
  return null;
}

// Pure orchestration used by both the DB-bound entry and the unit tests.
// Takes raw "prior log + today's prescription" pairs and returns the
// ordered, capped MovementHistoryEntry list. Spec §4.2 ordering:
// `(today's prescribed weight differs from prior prescribed weight) DESC,
//  workoutDate DESC` so the most decision-affecting context comes first.
export type MovementHistoryCandidate = {
  movementId: string;
  movementName: string;
  todayPrescribedLb: number | null;
  priorContext: PriorMovementContext;
};

export function shapeMovementHistoryEntries(
  candidates: MovementHistoryCandidate[],
  cap = MAX_MOVEMENT_HISTORY
): MovementHistoryEntry[] {
  const decorated = candidates.map((c) => {
    const differs =
      c.todayPrescribedLb != null &&
      c.priorContext.priorPrescribedLb != null &&
      c.todayPrescribedLb !== c.priorContext.priorPrescribedLb;
    return { c, differs };
  });
  decorated.sort((a, b) => {
    if (a.differs !== b.differs) return a.differs ? -1 : 1;
    return b.c.priorContext.workoutDate.localeCompare(a.c.priorContext.workoutDate);
  });
  return decorated.slice(0, cap).map(({ c }) => ({
    movementId: c.movementId,
    movementName: c.movementName,
    todayPrescribedLb: c.todayPrescribedLb,
    priorContext: c.priorContext,
  }));
}

// Pulls the most-recent prior log per movement on any *other* template
// within the freshness window. Excludes the current template
// (`excludeWorkoutId`) — the chip's tier 1 already shows same-template
// context. Returns one candidate per qualifying movement.
async function loadMovementHistoryCandidates(input: {
  userId: string;
  gender: string | null;
  sessionMovements: SessionTemplateMovement[];
  excludeWorkoutId: string;
}): Promise<MovementHistoryCandidate[]> {
  const { userId, gender, sessionMovements, excludeWorkoutId } = input;
  if (sessionMovements.length === 0) return [];

  const movementIds = sessionMovements.map((m) => m.movementId);
  const cutoff = daysAgoIso(MOVEMENT_HISTORY_WINDOW_DAYS);

  const rows = await db
    .select({
      movementId: crossfitWorkoutMovements.movementId,
      workoutDate: workoutSessions.workoutDate,
      actualWeight: scoreMovementDetails.actualWeight,
      setEntries: scoreMovementDetails.setEntries,
      rpe: scores.rpe,
      priorPrescribedMale: crossfitWorkoutMovements.prescribedWeightMale,
      priorPrescribedFemale: crossfitWorkoutMovements.prescribedWeightFemale,
      workoutTemplateTitle: crossfitWorkouts.title,
    })
    .from(scoreMovementDetails)
    .innerJoin(scores, eq(scores.id, scoreMovementDetails.scoreId))
    .innerJoin(
      crossfitWorkoutMovements,
      eq(
        crossfitWorkoutMovements.id,
        scoreMovementDetails.crossfitWorkoutMovementId
      )
    )
    .innerJoin(
      crossfitWorkouts,
      eq(crossfitWorkouts.id, crossfitWorkoutMovements.crossfitWorkoutId)
    )
    .innerJoin(
      workoutSessions,
      eq(workoutSessions.id, scores.workoutSessionId)
    )
    .where(
      and(
        eq(scores.userId, userId),
        inArray(crossfitWorkoutMovements.movementId, movementIds),
        ne(crossfitWorkoutMovements.crossfitWorkoutId, excludeWorkoutId),
        gte(workoutSessions.workoutDate, cutoff)
      )
    )
    .orderBy(desc(workoutSessions.workoutDate));

  const seen = new Set<string>();
  const candidates: MovementHistoryCandidate[] = [];
  for (const r of rows) {
    if (seen.has(r.movementId)) continue;
    const priorActual = representativeFromSetEntries(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      r.setEntries as any[] | null,
      r.actualWeight != null ? Number(r.actualWeight) : null
    );
    if (priorActual == null) continue;

    const session = sessionMovements.find((m) => m.movementId === r.movementId);
    if (!session) continue;

    const priorPrescribedRaw =
      gender === "female"
        ? r.priorPrescribedFemale ?? r.priorPrescribedMale
        : r.priorPrescribedMale ?? r.priorPrescribedFemale;
    const priorPrescribedLb =
      priorPrescribedRaw != null ? Number(priorPrescribedRaw) : null;
    const todayPrescribedLb =
      gender === "female"
        ? session.prescribedWeightFemale ?? session.prescribedWeightMale
        : session.prescribedWeightMale ?? session.prescribedWeightFemale;

    seen.add(r.movementId);
    candidates.push({
      movementId: r.movementId,
      movementName: session.movementName,
      todayPrescribedLb: todayPrescribedLb ?? null,
      priorContext: {
        workoutDate: r.workoutDate,
        priorPrescribedLb,
        priorActualLb: priorActual,
        rpe: r.rpe != null ? Number(r.rpe) : null,
        workoutTemplateTitle: r.workoutTemplateTitle,
      },
    });
  }
  return candidates;
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

// Walks `score_movement_details` for the user's recent scaled movements
// and rolls them up per canonical movement name. Returns candidates only
// for movements that appear in the workout (cuts the in-memory work to
// the names the picker actually cares about). The picker enforces the
// scale-count floor.
async function loadNoteNudgeCandidates(
  userId: string,
  workoutMovementNames: string[]
): Promise<NoteNudgeCandidate[]> {
  if (workoutMovementNames.length === 0) return [];
  const since = daysAgoIso(NUDGE_WINDOW_DAYS);
  const lowered = workoutMovementNames.map((n) => n.toLowerCase());

  const rows = await db
    .select({
      movementName: movements.canonicalName,
      scoreId: scoreMovementDetails.scoreId,
      workoutDate: workoutSessions.workoutDate,
    })
    .from(scoreMovementDetails)
    .innerJoin(scores, eq(scores.id, scoreMovementDetails.scoreId))
    .innerJoin(
      workoutSessions,
      eq(workoutSessions.id, scores.workoutSessionId)
    )
    .innerJoin(
      crossfitWorkoutMovements,
      eq(
        crossfitWorkoutMovements.id,
        scoreMovementDetails.crossfitWorkoutMovementId
      )
    )
    .innerJoin(movements, eq(movements.id, crossfitWorkoutMovements.movementId))
    .where(
      and(
        eq(scores.userId, userId),
        eq(scoreMovementDetails.wasRx, false),
        gte(workoutSessions.workoutDate, since),
        sql`lower(${movements.canonicalName}) = ANY(${lowered})`
      )
    );

  // Roll up to one entry per movement: distinct-score scale count + latest
  // scaled date.
  type Bucket = {
    movement: string;
    scoreIds: Set<string>;
    lastScaledAt: string;
  };
  const buckets = new Map<string, Bucket>();
  for (const r of rows) {
    const key = r.movementName.toLowerCase();
    let b = buckets.get(key);
    if (!b) {
      b = {
        movement: r.movementName,
        scoreIds: new Set([r.scoreId]),
        lastScaledAt: r.workoutDate,
      };
      buckets.set(key, b);
      continue;
    }
    b.scoreIds.add(r.scoreId);
    if (r.workoutDate > b.lastScaledAt) b.lastScaledAt = r.workoutDate;
  }

  return Array.from(buckets.values()).map((b) => ({
    movement: b.movement,
    scaleCount: b.scoreIds.size,
    lastScaledAt: b.lastScaledAt,
  }));
}

export async function getWorkoutPrepSignals(input: {
  userId: string;
  workoutId: string;
}): Promise<WorkoutPrepSignals> {
  const sessionTemplate = await loadSessionTemplateMovements(input.workoutId);
  const movementNames = sessionTemplate.movements.map((m) => m.movementName);
  if (movementNames.length === 0) {
    return {
      stretchGoals: [],
      complaintBanners: [],
      noteNudge: null,
      movementHistory: [],
    };
  }

  const [userRow] = await db
    .select({ gender: users.gender })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  const gender = userRow?.gender ?? null;

  const [signalRows, rawBanners, nudgeCandidates, historyCandidates] =
    await Promise.all([
      selectMovementSignalsForPrep(input.userId, movementNames),
      loadMovementComplaintsForUser(input.userId, movementNames),
      loadNoteNudgeCandidates(input.userId, movementNames),
      sessionTemplate.crossfitWorkoutId
        ? loadMovementHistoryCandidates({
            userId: input.userId,
            gender,
            sessionMovements: sessionTemplate.movements,
            excludeWorkoutId: sessionTemplate.crossfitWorkoutId,
          })
        : Promise.resolve([] as MovementHistoryCandidate[]),
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
    noteNudge: pickNoteNudge(nudgeCandidates),
    movementHistory: shapeMovementHistoryEntries(historyCandidates),
  };
}
