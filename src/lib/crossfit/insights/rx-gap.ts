// ============================================
// RX-Gap Movements
// ============================================
//
// Surface the movements that, if mastered at RX, would unlock the most
// previously-scaled workouts. Built on `score_movement_details.was_rx`.
//
// See claude_code_instructions/crossfit_smart_insights_spec.md §8.

import { db } from "@/db";
import {
  scores,
  scoreMovementDetails,
  workoutMovements,
  workouts,
  movements,
} from "@/db/schema";
import { and, eq, gte } from "drizzle-orm";

const DEFAULT_WINDOW_DAYS = 180;

export type RxGapMovement = {
  movementId: string;
  movementName: string;
  scalingRate: number;
  scaledInstances: number;
  totalInstances: number;
  soleBlockerUnlocks: number;
  partialBlockerAppearances: number;
  rxStandardSummary: string | null;
  topModification: string | null;
};

export type RxGapResult = {
  gaps: RxGapMovement[];
  totalScoredWorkouts: number;
  totalRxWorkouts: number;
  windowDays: number;
};

type DetailRow = {
  scoreId: string;
  workoutDate: string;
  division: string;
  movementId: string;
  movementName: string;
  wasRx: boolean;
  modification: string | null;
  rxStandard: string | null;
  prescribedWeightMale: number | null;
  prescribedWeightFemale: number | null;
};

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchDetails(
  userId: string,
  windowDays: number
): Promise<DetailRow[]> {
  const since = toIsoDate(daysAgo(windowDays));

  const rows = await db
    .select({
      scoreId: scores.id,
      workoutDate: workouts.workoutDate,
      division: scores.division,
      movementId: movements.id,
      movementName: movements.canonicalName,
      wasRx: scoreMovementDetails.wasRx,
      modification: scoreMovementDetails.modification,
      rxStandard: workoutMovements.rxStandard,
      prescribedWeightMale: workoutMovements.prescribedWeightMale,
      prescribedWeightFemale: workoutMovements.prescribedWeightFemale,
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
      and(eq(scores.userId, userId), gte(workouts.workoutDate, since))
    );

  return rows.map((r) => ({
    scoreId: r.scoreId,
    workoutDate: r.workoutDate,
    division: r.division,
    movementId: r.movementId,
    movementName: r.movementName,
    wasRx: r.wasRx,
    modification: r.modification,
    rxStandard: r.rxStandard,
    prescribedWeightMale:
      r.prescribedWeightMale != null ? Number(r.prescribedWeightMale) : null,
    prescribedWeightFemale:
      r.prescribedWeightFemale != null ? Number(r.prescribedWeightFemale) : null,
  }));
}

function summarizeRxStandard(rows: DetailRow[]): string | null {
  // Most common non-empty rxStandard, falling back to a gendered weight pair.
  const standards = new Map<string, number>();
  for (const r of rows) {
    if (r.rxStandard && r.rxStandard.trim()) {
      const key = r.rxStandard.trim();
      standards.set(key, (standards.get(key) ?? 0) + 1);
    }
  }
  if (standards.size > 0) {
    let bestKey = "";
    let bestCount = -1;
    for (const [k, c] of standards) {
      if (c > bestCount) {
        bestKey = k;
        bestCount = c;
      }
    }
    return bestKey;
  }

  // Fall back to weights if every row carried prescribed weight.
  const sample = rows.find(
    (r) => r.prescribedWeightMale != null || r.prescribedWeightFemale != null
  );
  if (sample) {
    const male = sample.prescribedWeightMale;
    const female = sample.prescribedWeightFemale;
    if (male != null && female != null) return `${male}/${female} lb`;
    if (male != null) return `${male} lb`;
    if (female != null) return `${female} lb`;
  }
  return null;
}

function topModification(rows: DetailRow[]): string | null {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.modification) continue;
    const key = r.modification.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let bestKey = "";
  let bestCount = -1;
  for (const [k, c] of counts) {
    if (c > bestCount) {
      bestKey = k;
      bestCount = c;
    }
  }
  return bestKey;
}

// ============================================
// Public entry point
// ============================================

export async function computeRxGap(
  userId: string,
  opts?: { windowDays?: number }
): Promise<RxGapResult> {
  const windowDays = Math.max(30, Math.min(opts?.windowDays ?? DEFAULT_WINDOW_DAYS, 730));
  const rows = await fetchDetails(userId, windowDays);

  if (rows.length === 0) {
    return {
      gaps: [],
      totalScoredWorkouts: 0,
      totalRxWorkouts: 0,
      windowDays,
    };
  }

  // Group by score to determine sole-blocker vs multi-blocker workouts.
  type ScoreSummary = {
    nonRxMovementIds: Set<string>;
  };
  const byScore = new Map<string, ScoreSummary>();
  for (const r of rows) {
    let s = byScore.get(r.scoreId);
    if (!s) {
      s = { nonRxMovementIds: new Set() };
      byScore.set(r.scoreId, s);
    }
    if (!r.wasRx) s.nonRxMovementIds.add(r.movementId);
  }

  const totalScoredWorkouts = byScore.size;
  let totalRxWorkouts = 0;
  for (const s of byScore.values()) {
    if (s.nonRxMovementIds.size === 0) totalRxWorkouts += 1;
  }

  // Group by movement to compute the per-movement metrics.
  type Acc = {
    movementName: string;
    rows: DetailRow[];
    instancesByScore: Map<string, { wasRxAny: boolean; wasScaledAny: boolean }>;
    soleBlockerScores: Set<string>;
    partialBlockerScores: Set<string>;
  };
  const byMovement = new Map<string, Acc>();

  for (const r of rows) {
    let acc = byMovement.get(r.movementId);
    if (!acc) {
      acc = {
        movementName: r.movementName,
        rows: [],
        instancesByScore: new Map(),
        soleBlockerScores: new Set(),
        partialBlockerScores: new Set(),
      };
      byMovement.set(r.movementId, acc);
    }
    acc.rows.push(r);

    const cur = acc.instancesByScore.get(r.scoreId) ?? {
      wasRxAny: false,
      wasScaledAny: false,
    };
    if (r.wasRx) cur.wasRxAny = true;
    else cur.wasScaledAny = true;
    acc.instancesByScore.set(r.scoreId, cur);
  }

  // Walk scores to mark sole vs partial blocker per movement.
  for (const [scoreId, summary] of byScore) {
    const blockers = summary.nonRxMovementIds;
    if (blockers.size === 0) continue;
    if (blockers.size === 1) {
      const [only] = blockers;
      const acc = byMovement.get(only);
      if (acc) acc.soleBlockerScores.add(scoreId);
    } else {
      for (const movId of blockers) {
        const acc = byMovement.get(movId);
        if (acc) acc.partialBlockerScores.add(scoreId);
      }
    }
  }

  const gaps: RxGapMovement[] = [];
  for (const [movementId, acc] of byMovement) {
    let scaled = 0;
    for (const v of acc.instancesByScore.values()) {
      if (v.wasScaledAny) scaled += 1;
    }
    if (scaled === 0) continue; // never scaled — not a "gap"

    const total = acc.instancesByScore.size;
    const sole = acc.soleBlockerScores.size;
    const partial = acc.partialBlockerScores.size;
    const scaledRows = acc.rows.filter((r) => !r.wasRx);

    gaps.push({
      movementId,
      movementName: acc.movementName,
      scalingRate: total > 0 ? scaled / total : 0,
      scaledInstances: scaled,
      totalInstances: total,
      soleBlockerUnlocks: sole,
      partialBlockerAppearances: partial,
      rxStandardSummary: summarizeRxStandard(acc.rows),
      topModification: topModification(scaledRows),
    });
  }

  // Rank: sole-blocker desc, then scaling rate desc, then total instances desc.
  gaps.sort((a, b) => {
    if (b.soleBlockerUnlocks !== a.soleBlockerUnlocks) {
      return b.soleBlockerUnlocks - a.soleBlockerUnlocks;
    }
    if (b.scalingRate !== a.scalingRate) {
      return b.scalingRate - a.scalingRate;
    }
    return b.totalInstances - a.totalInstances;
  });

  return {
    gaps,
    totalScoredWorkouts,
    totalRxWorkouts,
    windowDays,
  };
}
