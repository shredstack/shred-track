// ============================================
// 1RM Predictor
// ============================================
//
// Estimate a current 1RM for `is1rmApplicable` movements the user hasn't
// directly tested in the last 365 days, using their recent heavy-set data.
//
// See claude_code_instructions/crossfit_smart_insights_spec.md §7.

import { db } from "@/db";
import {
  scores,
  scoreMovementDetails,
  workoutMovements,
  workouts,
  movements,
} from "@/db/schema";
import { and, eq, gte } from "drizzle-orm";
import { normalizeSetEntries } from "@/lib/crossfit/set-entries";
import type { SetEntry } from "@/types/crossfit";

const PREDICTION_WINDOW_DAYS = 90;
const SUFFICIENCY_WINDOW_DAYS = 180;
const RECENT_TEST_WINDOW_DAYS = 365;
const MAX_REPS_FOR_FORMULA = 10;
const MIN_DISTINCT_SESSIONS = 2;
// Sets logged at RPE < this are treated as warmups and excluded from the
// e1RM pool. Sets without RPE are included (legacy data, pre-RPE rollout).
// Per spec §7.3 "Phase 1.5".
const MIN_RPE_FOR_QUALIFYING = 7;

// "1", "1RM", or "1 rep max" — case-insensitive.
const ONE_RM_REP_SCHEME = /^\s*(1|1\s*rm|1\s*rep\s*max)\s*$/i;

export type Predicted1RM = {
  movementId: string;
  movementName: string;
  estimatedOneRm: number;
  confidenceBandPct: number;
  qualifyingSetsCount: number;
  bestSet: { weight: number; reps: number; loggedAt: string };
  lastDirectTest: { weight: number; loggedAt: string } | null;
  monthsSinceLastTest: number | null;
  contributingSets: ContributingSet[];
};

export type ContributingSet = {
  weight: number;
  reps: number;
  rpe?: number;
  loggedAt: string;
  estimatedOneRm: number;
};

export type StaleLift = {
  movementId: string;
  movementName: string;
  lastDirectTest: { weight: number; loggedAt: string } | null;
  monthsSinceLastTest: number | null;
  monthsSinceAnyLog: number | null;
};

export type Predicted1RMResult = {
  predictions: Predicted1RM[];
  staleLifts: StaleLift[];
};

type RawSetRow = {
  movementId: string;
  movementName: string;
  is1rmApplicable: boolean;
  scoreId: string;
  workoutDate: string; // YYYY-MM-DD
  workoutType: string;
  workoutRepScheme: string | null;
  actualWeight: number | null;
  setEntries: SetEntry[];
};

// Brzycki: weight × 36 / (37 − reps). Preferred for reps 2..10.
function brzycki(weight: number, reps: number): number {
  if (reps <= 1) return weight;
  if (reps >= 37) return weight; // would divide by zero or go negative
  return weight * (36 / (37 - reps));
}

// Epley: weight × (1 + reps / 30). Sanity check.
function epley(weight: number, reps: number): number {
  return weight * (1 + reps / 30);
}

export function estimatedOneRmForSet(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0;
  if (reps === 1) return weight;
  return Math.max(brzycki(weight, reps), epley(weight, reps));
}

function bandFor(qualifyingCount: number): number {
  if (qualifyingCount >= 6) return 4;
  if (qualifyingCount >= 3) return 6;
  return 10;
}

function monthsBetween(fromIso: string, to: Date): number {
  const from = new Date(fromIso);
  const ms = to.getTime() - from.getTime();
  return ms / (1000 * 60 * 60 * 24 * 30.4375);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Pull every set the user has logged for any 1RM-applicable movement in the
// lookback window. We over-fetch (RECENT_TEST_WINDOW_DAYS) so we can spot
// direct 1RM tests that happened beyond the prediction window.
async function fetchSetData(
  userId: string,
  windowDays: number
): Promise<RawSetRow[]> {
  const since = toIsoDate(daysAgo(windowDays));

  const rows = await db
    .select({
      movementId: movements.id,
      movementName: movements.canonicalName,
      is1rmApplicable: movements.is1rmApplicable,
      scoreId: scores.id,
      workoutDate: workouts.workoutDate,
      workoutType: workouts.workoutType,
      workoutRepScheme: workouts.repScheme,
      actualWeight: scoreMovementDetails.actualWeight,
      setEntries: scoreMovementDetails.setEntries,
    })
    .from(scoreMovementDetails)
    .innerJoin(scores, eq(scores.id, scoreMovementDetails.scoreId))
    .innerJoin(
      workoutMovements,
      eq(workoutMovements.id, scoreMovementDetails.workoutMovementId)
    )
    .innerJoin(workouts, eq(workouts.id, scores.workoutId))
    .innerJoin(movements, eq(movements.id, workoutMovements.movementId))
    .where(
      and(
        eq(scores.userId, userId),
        eq(movements.is1rmApplicable, true),
        gte(workouts.workoutDate, since)
      )
    );

  return rows.map((r) => ({
    movementId: r.movementId,
    movementName: r.movementName,
    is1rmApplicable: r.is1rmApplicable,
    scoreId: r.scoreId,
    workoutDate: r.workoutDate,
    workoutType: r.workoutType,
    workoutRepScheme: r.workoutRepScheme,
    actualWeight: r.actualWeight != null ? Number(r.actualWeight) : null,
    setEntries: normalizeSetEntries(r.setEntries),
  }));
}

type WorkingSet = {
  weight: number;
  reps: number;
  rpe?: number;
  loggedAt: string; // YYYY-MM-DD
};

// Expand a raw row into one or more (weight, reps, rpe?) sets we can score.
//
// Preferred shape: `setEntries` carries per-set { weight, reps?, rpe? }.
// When reps is present we use it directly — most accurate. When reps is
// missing on a set (legacy data pre-migration) we fall back to the workout's
// repScheme.
//
// Single-set fallback: when there are no setEntries but `actualWeight` is
// populated, treat it as one set and use the scheme reps.
//
// Skips sets whose reps are out of the formula's usable range (1..10).
function expandSets(row: RawSetRow): WorkingSet[] {
  const fallbackReps = parseRepScheme(row.workoutRepScheme);

  const out: WorkingSet[] = [];

  if (row.setEntries.length > 0) {
    for (const e of row.setEntries) {
      const reps = e.reps ?? fallbackReps ?? null;
      if (reps == null || reps < 1 || reps > MAX_REPS_FOR_FORMULA) continue;
      out.push({
        weight: e.weight,
        reps,
        rpe: e.rpe,
        loggedAt: row.workoutDate,
      });
    }
    return out;
  }

  if (row.actualWeight != null && row.actualWeight > 0) {
    if (
      fallbackReps != null &&
      fallbackReps >= 1 &&
      fallbackReps <= MAX_REPS_FOR_FORMULA
    ) {
      out.push({
        weight: row.actualWeight,
        reps: fallbackReps,
        loggedAt: row.workoutDate,
      });
    }
  }
  return out;
}

// Try to read a per-set reps figure out of a workout-level repScheme.
//
// Accepts:
//   "5"            → 5
//   "5×3"          → 3   (the inner "reps per set" figure)
//   "5x3"          → 3
//   "3 reps"       → 3
// Returns null when ambiguous (e.g. ladders like "21-15-9").
export function parseRepScheme(scheme: string | null): number | null {
  if (!scheme) return null;
  const trimmed = scheme.trim();
  if (!trimmed) return null;

  const xMatch = trimmed.match(/^(\d+)\s*[x×]\s*(\d+)\s*$/i);
  if (xMatch) {
    const reps = parseInt(xMatch[2], 10);
    return Number.isFinite(reps) ? reps : null;
  }

  const flat = trimmed.match(/^(\d+)(\s*reps?)?$/i);
  if (flat) {
    const reps = parseInt(flat[1], 10);
    return Number.isFinite(reps) ? reps : null;
  }

  return null;
}

function isDirectOneRmTest(row: RawSetRow): boolean {
  if (
    row.workoutType === "for_load" &&
    row.workoutRepScheme &&
    ONE_RM_REP_SCHEME.test(row.workoutRepScheme.trim())
  ) {
    return true;
  }
  // Any set with reps=1 also counts (per spec §7.2).
  if (row.setEntries.some((e) => e.reps === 1)) return true;
  return parseRepScheme(row.workoutRepScheme) === 1;
}

function pickDirectTestWeight(row: RawSetRow): number | null {
  if (row.setEntries.length > 0) {
    return Math.max(...row.setEntries.map((e) => e.weight));
  }
  if (row.actualWeight != null && row.actualWeight > 0) {
    return row.actualWeight;
  }
  return null;
}

// ============================================
// Public entry point
// ============================================

export async function estimate1RMForUser(
  userId: string,
  opts?: { now?: Date; windowDays?: number }
): Promise<Predicted1RMResult> {
  const now = opts?.now ?? new Date();
  const lookbackDays = opts?.windowDays ?? RECENT_TEST_WINDOW_DAYS;

  const rows = await fetchSetData(userId, lookbackDays);
  if (rows.length === 0) {
    return { predictions: [], staleLifts: [] };
  }

  // Group rows per movement.
  const byMovement = new Map<
    string,
    { name: string; rows: RawSetRow[] }
  >();
  for (const r of rows) {
    const cur = byMovement.get(r.movementId);
    if (cur) cur.rows.push(r);
    else byMovement.set(r.movementId, { name: r.movementName, rows: [r] });
  }

  const predictions: Predicted1RM[] = [];
  const staleLifts: StaleLift[] = [];

  const recentTestCutoff = daysAgo(RECENT_TEST_WINDOW_DAYS);
  const sufficiencyCutoff = daysAgo(SUFFICIENCY_WINDOW_DAYS);
  const predictionCutoff = daysAgo(PREDICTION_WINDOW_DAYS);

  for (const [movementId, { name, rows: movRows }] of byMovement) {
    // Find the most recent direct 1RM test (any time in the lookback window).
    let lastTest: { weight: number; loggedAt: string } | null = null;
    let lastTestRow: RawSetRow | null = null;
    for (const r of movRows) {
      if (!isDirectOneRmTest(r)) continue;
      const w = pickDirectTestWeight(r);
      if (w == null) continue;
      if (!lastTest || r.workoutDate > lastTest.loggedAt) {
        lastTest = { weight: w, loggedAt: r.workoutDate };
        lastTestRow = r;
      }
    }

    const monthsSinceLastTest = lastTest
      ? monthsBetween(lastTest.loggedAt, now)
      : null;

    const recentlyTested =
      lastTestRow != null &&
      new Date(lastTestRow.workoutDate) >= recentTestCutoff;

    if (recentlyTested) {
      // Excluded from predictions per §7.2(2).
      continue;
    }

    // Sufficiency check — distinct sessions (workout dates) in last 180d.
    const sufficiencyDates = new Set<string>();
    for (const r of movRows) {
      if (new Date(r.workoutDate) >= sufficiencyCutoff) {
        sufficiencyDates.add(r.workoutDate);
      }
    }
    const sufficient = sufficiencyDates.size >= MIN_DISTINCT_SESSIONS;

    if (!sufficient) {
      const lastAnyLog = movRows
        .map((r) => r.workoutDate)
        .sort()
        .pop();
      staleLifts.push({
        movementId,
        movementName: name,
        lastDirectTest: lastTest,
        monthsSinceLastTest,
        monthsSinceAnyLog: lastAnyLog ? monthsBetween(lastAnyLog, now) : null,
      });
      continue;
    }

    // Build the qualifying-set pool inside the prediction window. Skip rows
    // that *are* the direct 1RM test (reps=1) — the formula doesn't apply.
    // Drop sets logged at low RPE (warmups). Sets without RPE pass through.
    const pool: ContributingSet[] = [];
    for (const r of movRows) {
      if (new Date(r.workoutDate) < predictionCutoff) continue;
      if (parseRepScheme(r.workoutRepScheme) === 1) continue; // it IS a 1RM
      const sets = expandSets(r);
      for (const s of sets) {
        if (s.rpe != null && s.rpe < MIN_RPE_FOR_QUALIFYING) continue;
        const e1rm = estimatedOneRmForSet(s.weight, s.reps);
        if (e1rm > 0) {
          pool.push({
            weight: s.weight,
            reps: s.reps,
            rpe: s.rpe,
            loggedAt: s.loggedAt,
            estimatedOneRm: e1rm,
          });
        }
      }
    }

    if (pool.length === 0) {
      // No usable sets in the prediction window — surface as stale instead.
      const lastAnyLog = movRows
        .map((r) => r.workoutDate)
        .sort()
        .pop();
      staleLifts.push({
        movementId,
        movementName: name,
        lastDirectTest: lastTest,
        monthsSinceLastTest,
        monthsSinceAnyLog: lastAnyLog ? monthsBetween(lastAnyLog, now) : null,
      });
      continue;
    }

    const best = pool.reduce((a, b) => (b.estimatedOneRm > a.estimatedOneRm ? b : a));

    predictions.push({
      movementId,
      movementName: name,
      estimatedOneRm: Math.round(best.estimatedOneRm),
      confidenceBandPct: bandFor(pool.length),
      qualifyingSetsCount: pool.length,
      bestSet: {
        weight: best.weight,
        reps: best.reps,
        loggedAt: best.loggedAt,
      },
      lastDirectTest: lastTest,
      monthsSinceLastTest,
      contributingSets: pool
        .slice()
        .sort((a, b) => b.estimatedOneRm - a.estimatedOneRm)
        .slice(0, 8),
    });
  }

  // Sort: stalest first, then highest predicted first.
  predictions.sort((a, b) => {
    const aMonths = a.monthsSinceLastTest ?? Infinity;
    const bMonths = b.monthsSinceLastTest ?? Infinity;
    if (aMonths !== bMonths) return bMonths - aMonths;
    return b.estimatedOneRm - a.estimatedOneRm;
  });

  staleLifts.sort((a, b) => {
    const am = a.monthsSinceAnyLog ?? Infinity;
    const bm = b.monthsSinceAnyLog ?? Infinity;
    return bm - am;
  });

  return { predictions, staleLifts };
}
