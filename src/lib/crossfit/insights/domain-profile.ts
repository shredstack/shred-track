// ============================================
// Domain Profile (Strong vs Weak)
// ============================================
//
// Bucket the user's logged movements into the four CrossFit domains
// (weightlifting / gymnastics / monostructural / mixed) and compute volume,
// scaling, progression, and relative emphasis over a 90-day window with a
// 90-day comparison window.
//
// See claude_code_instructions/crossfit_smart_insights_spec.md §9.

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
import { estimatedOneRmForSet, parseRepScheme } from "@/lib/crossfit/insights/predicted-1rm";
import type { SetEntry } from "@/types/crossfit";

const WINDOW_DAYS = 90;
const COMPARE_WINDOW_DAYS = 90;
const MIN_SPAN_DAYS = 56; // 8 weeks per spec §9.7

export type DomainKey =
  | "weightlifting"
  | "gymnastics"
  | "monostructural"
  | "mixed";

export const DOMAIN_KEYS: DomainKey[] = [
  "weightlifting",
  "gymnastics",
  "monostructural",
  "mixed",
];

export type ProgressionDirection = "up" | "flat" | "down";
export type ProgressionMetricKey =
  | "volume"
  | "scaling_rate"
  | "avg_e1rm";

export type ProgressionMetric = {
  metric: ProgressionMetricKey;
  label: string;
  current: number | null;
  prior: number | null;
  // 'up' always means "better for the athlete" — for scaling_rate this means
  // the rate dropped.
  direction: ProgressionDirection;
  magnitudePct: number; // unsigned magnitude of the relative change
};

export type DomainMetrics = {
  domain: DomainKey;
  // Current window
  volumeScore: number;
  scalingRate: number;
  relativeEmphasis: number;
  movementInstances: number;
  scaledInstances: number;
  // Prior window (raw, for the card to render side-by-side if it wants)
  priorVolumeScore: number;
  priorScalingRate: number;
  priorMovementInstances: number;
  priorRelativeEmphasis: number;
  // Per-domain progression signals (always at least `volume`).
  progression: ProgressionMetric[];
};

export type DomainProfile = {
  windowDays: number;
  windowStart: string;
  windowEnd: string;
  priorWindowStart: string;
  priorWindowEnd: string;
  totalScores: number;
  totalDistinctWorkouts: number;
  scoringSpanDays: number;
  hasEnoughData: boolean;
  domains: DomainMetrics[];
  strongDomain: DomainKey | null;
  weakDomain: DomainKey | null;
};

// Exposed as a public type so tests (and other consumers) can build fixtures
// without depending on the DB.
export type DomainProfileRow = {
  scoreId: string;
  // Nullable post-cutover — unified-schema score rows leave workout_id null.
  workoutId: string | null;
  workoutDate: string;
  workoutType: string;
  workoutRepScheme: string | null;
  movementId: string;
  movementCategory: string;
  movementIsWeighted: boolean;
  movementIs1rmApplicable: boolean;
  wasRx: boolean;
  actualWeight: number | null;
  setEntries: SetEntry[];
};

function daysAgoFrom(from: Date, n: number): Date {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function daysAgo(n: number): Date {
  return daysAgoFrom(new Date(), n);
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function bucketFor(category: string, isWeighted: boolean): DomainKey {
  switch (category) {
    case "barbell":
    case "dumbbell":
      return "weightlifting";
    case "kettlebell":
      return isWeighted ? "weightlifting" : "mixed";
    case "gymnastics":
    case "bodyweight":
      return "gymnastics";
    case "monostructural":
      return "monostructural";
    default:
      return "mixed";
  }
}

async function fetchRows(userId: string, lookbackDays: number): Promise<DomainProfileRow[]> {
  const since = toIsoDate(daysAgo(lookbackDays));

  const rows = await db
    .select({
      scoreId: scores.id,
      workoutId: scores.workoutId,
      workoutDate: workouts.workoutDate,
      workoutType: workouts.workoutType,
      workoutRepScheme: workouts.repScheme,
      movementId: movements.id,
      movementCategory: movements.category,
      movementIsWeighted: movements.isWeighted,
      movementIs1rmApplicable: movements.is1rmApplicable,
      wasRx: scoreMovementDetails.wasRx,
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
    .where(and(eq(scores.userId, userId), gte(workouts.workoutDate, since)));

  return rows.map((r) => ({
    scoreId: r.scoreId,
    workoutId: r.workoutId,
    workoutDate: r.workoutDate,
    workoutType: r.workoutType,
    workoutRepScheme: r.workoutRepScheme,
    movementId: r.movementId,
    movementCategory: r.movementCategory,
    movementIsWeighted: r.movementIsWeighted,
    movementIs1rmApplicable: r.movementIs1rmApplicable,
    wasRx: r.wasRx,
    actualWeight: r.actualWeight != null ? Number(r.actualWeight) : null,
    setEntries: normalizeSetEntries(r.setEntries),
  }));
}

type WindowAgg = {
  // Per domain
  workoutIdsByDomain: Map<DomainKey, Set<string>>;
  totalsByDomain: Map<DomainKey, { total: number; scaled: number }>;
  // For e1RM (weightlifting only): movementId → best e1RM in window
  bestE1rmByMovement: Map<string, { e1rm: number; movementDomain: DomainKey }>;
};

function emptyWindow(): WindowAgg {
  const workoutIdsByDomain = new Map<DomainKey, Set<string>>();
  const totalsByDomain = new Map<
    DomainKey,
    { total: number; scaled: number }
  >();
  for (const k of DOMAIN_KEYS) {
    workoutIdsByDomain.set(k, new Set());
    totalsByDomain.set(k, { total: 0, scaled: 0 });
  }
  return {
    workoutIdsByDomain,
    totalsByDomain,
    bestE1rmByMovement: new Map(),
  };
}

function aggregate(rows: DomainProfileRow[]): WindowAgg {
  const agg = emptyWindow();

  for (const r of rows) {
    const domain = bucketFor(r.movementCategory, r.movementIsWeighted);
    // Skip rows that lack a legacy workoutId (unified-schema writes);
    // commit #6's reader carries the session/template id forward.
    if (!r.workoutId) continue;
    agg.workoutIdsByDomain.get(domain)!.add(r.workoutId);
    const totals = agg.totalsByDomain.get(domain)!;
    totals.total += 1;
    if (!r.wasRx) totals.scaled += 1;

    if (r.movementIs1rmApplicable && domain === "weightlifting") {
      const fallbackReps = parseRepScheme(r.workoutRepScheme);

      let candidates: Array<{ weight: number; reps: number }> = [];
      if (r.setEntries.length > 0) {
        for (const e of r.setEntries) {
          const reps = e.reps ?? fallbackReps ?? null;
          if (reps == null || reps < 1 || reps > 10) continue;
          candidates.push({ weight: e.weight, reps });
        }
      } else if (
        r.actualWeight != null &&
        r.actualWeight > 0 &&
        fallbackReps != null &&
        fallbackReps >= 1 &&
        fallbackReps <= 10
      ) {
        candidates = [{ weight: r.actualWeight, reps: fallbackReps }];
      }

      for (const c of candidates) {
        const e1rm = estimatedOneRmForSet(c.weight, c.reps);
        if (e1rm <= 0) continue;
        const cur = agg.bestE1rmByMovement.get(r.movementId);
        if (!cur || e1rm > cur.e1rm) {
          agg.bestE1rmByMovement.set(r.movementId, {
            e1rm,
            movementDomain: domain,
          });
        }
      }
    }
  }

  return agg;
}

// Compute relative-change percent. When prior is 0 and current is positive we
// can't form a percent, so return Infinity-as-100 to keep the caller's UI
// honest. When both are 0, return 0.
function pctChange(current: number, prior: number): number {
  if (prior === 0 && current === 0) return 0;
  if (prior === 0) return 100;
  return ((current - prior) / prior) * 100;
}

function directionOf(
  signedDeltaPct: number,
  higherIsBetter: boolean
): ProgressionDirection {
  if (Math.abs(signedDeltaPct) < 5) return "flat";
  if (signedDeltaPct > 0) return higherIsBetter ? "up" : "down";
  return higherIsBetter ? "down" : "up";
}

function buildProgression(
  domain: DomainKey,
  current: WindowAgg,
  prior: WindowAgg
): ProgressionMetric[] {
  const metrics: ProgressionMetric[] = [];

  const curWorkouts = current.workoutIdsByDomain.get(domain)!.size;
  const priWorkouts = prior.workoutIdsByDomain.get(domain)!.size;
  const volChange = pctChange(curWorkouts, priWorkouts);
  metrics.push({
    metric: "volume",
    label: "Volume",
    current: curWorkouts,
    prior: priWorkouts,
    direction: directionOf(volChange, true),
    magnitudePct: Math.abs(volChange),
  });

  const curTotals = current.totalsByDomain.get(domain)!;
  const priTotals = prior.totalsByDomain.get(domain)!;
  const curRate = curTotals.total > 0 ? curTotals.scaled / curTotals.total : 0;
  const priRate = priTotals.total > 0 ? priTotals.scaled / priTotals.total : 0;
  // Only show scaling rate when there was meaningful in-domain volume in
  // either window — otherwise the metric is noise.
  if (curTotals.total + priTotals.total >= 4) {
    const rateChange = pctChange(curRate, priRate);
    metrics.push({
      metric: "scaling_rate",
      label: "Scaling rate",
      current: curRate,
      prior: priRate,
      direction: directionOf(rateChange, false),
      magnitudePct: Math.abs(rateChange),
    });
  }

  if (domain === "weightlifting") {
    const curMovs = [...current.bestE1rmByMovement.entries()].filter(
      ([, v]) => v.movementDomain === "weightlifting"
    );
    const priMovs = new Map(
      [...prior.bestE1rmByMovement.entries()]
        .filter(([, v]) => v.movementDomain === "weightlifting")
        .map(([k, v]) => [k, v.e1rm])
    );

    // Average across movements that had qualifying sets in BOTH windows so
    // we're comparing like-for-like.
    const overlaps: Array<{ cur: number; pri: number }> = [];
    for (const [mid, cur] of curMovs) {
      const pri = priMovs.get(mid);
      if (pri != null) overlaps.push({ cur: cur.e1rm, pri });
    }
    if (overlaps.length > 0) {
      const avgCur =
        overlaps.reduce((s, o) => s + o.cur, 0) / overlaps.length;
      const avgPri =
        overlaps.reduce((s, o) => s + o.pri, 0) / overlaps.length;
      const change = pctChange(avgCur, avgPri);
      metrics.push({
        metric: "avg_e1rm",
        label: "Avg e1RM",
        current: Math.round(avgCur),
        prior: Math.round(avgPri),
        direction: directionOf(change, true),
        magnitudePct: Math.abs(change),
      });
    }
  }

  return metrics;
}

// ============================================
// Pure aggregation (DB-free, unit-testable)
// ============================================

export function computeDomainProfileFromRows(
  rows: DomainProfileRow[],
  opts?: { now?: Date }
): DomainProfile {
  const now = opts?.now ?? new Date();

  const windowEnd = toIsoDate(now);
  const windowStart = toIsoDate(daysAgoFrom(now, WINDOW_DAYS));
  const priorWindowEnd = windowStart;
  const priorWindowStart = toIsoDate(
    daysAgoFrom(now, WINDOW_DAYS + COMPARE_WINDOW_DAYS)
  );

  const currentRows = rows.filter((r) => r.workoutDate >= windowStart);
  const priorRows = rows.filter(
    (r) => r.workoutDate >= priorWindowStart && r.workoutDate < windowStart
  );

  const totalScores = new Set(rows.map((r) => r.scoreId)).size;
  const totalDistinctWorkouts = new Set(rows.map((r) => r.workoutId)).size;

  let scoringSpanDays = 0;
  if (rows.length > 0) {
    const dates = rows.map((r) => r.workoutDate).sort();
    const first = new Date(dates[0]);
    const last = new Date(dates[dates.length - 1]);
    scoringSpanDays = Math.round(
      (last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24)
    );
  }

  const hasEnoughData = scoringSpanDays >= MIN_SPAN_DAYS;

  const current = aggregate(currentRows);
  const prior = aggregate(priorRows);

  // Sum of current-window volumeScores for relativeEmphasis denominator.
  let totalCurrentVolume = 0;
  let totalPriorVolume = 0;
  for (const k of DOMAIN_KEYS) {
    totalCurrentVolume += current.workoutIdsByDomain.get(k)!.size;
    totalPriorVolume += prior.workoutIdsByDomain.get(k)!.size;
  }

  const domainsOut: DomainMetrics[] = DOMAIN_KEYS.map((domain) => {
    const curW = current.workoutIdsByDomain.get(domain)!.size;
    const priW = prior.workoutIdsByDomain.get(domain)!.size;
    const curTotals = current.totalsByDomain.get(domain)!;
    const priTotals = prior.totalsByDomain.get(domain)!;
    const curRate = curTotals.total > 0 ? curTotals.scaled / curTotals.total : 0;
    const priRate = priTotals.total > 0 ? priTotals.scaled / priTotals.total : 0;
    const relEmphasis = totalCurrentVolume > 0 ? curW / totalCurrentVolume : 0;
    const priEmphasis = totalPriorVolume > 0 ? priW / totalPriorVolume : 0;

    return {
      domain,
      volumeScore: curW,
      scalingRate: curRate,
      relativeEmphasis: relEmphasis,
      movementInstances: curTotals.total,
      scaledInstances: curTotals.scaled,
      priorVolumeScore: priW,
      priorScalingRate: priRate,
      priorMovementInstances: priTotals.total,
      priorRelativeEmphasis: priEmphasis,
      progression: buildProgression(domain, current, prior),
    };
  });

  // Strong = best balance score; weak = worst. Score combines presence
  // (relativeEmphasis) and quality (1 - scalingRate). Domains with zero
  // movement instances are excluded so we don't crown an unused bucket.
  const present = domainsOut.filter((d) => d.movementInstances > 0);
  let strongDomain: DomainKey | null = null;
  let weakDomain: DomainKey | null = null;
  if (present.length > 0) {
    const scored = present.map((d) => ({
      domain: d.domain,
      score: d.relativeEmphasis * (1 - d.scalingRate),
    }));
    scored.sort((a, b) => b.score - a.score);
    strongDomain = scored[0].domain;
    if (scored.length > 1) {
      const last = scored[scored.length - 1];
      if (last.domain !== strongDomain) weakDomain = last.domain;
    }
  }

  return {
    windowDays: WINDOW_DAYS,
    windowStart,
    windowEnd,
    priorWindowStart,
    priorWindowEnd,
    totalScores,
    totalDistinctWorkouts,
    scoringSpanDays,
    hasEnoughData,
    domains: domainsOut,
    strongDomain,
    weakDomain,
  };
}

// ============================================
// Public entry point (DB-backed wrapper)
// ============================================

export async function computeDomainProfile(
  userId: string,
  opts?: { now?: Date }
): Promise<DomainProfile> {
  const lookbackDays = WINDOW_DAYS + COMPARE_WINDOW_DAYS;
  const rows = await fetchRows(userId, lookbackDays);
  return computeDomainProfileFromRows(rows, opts);
}
