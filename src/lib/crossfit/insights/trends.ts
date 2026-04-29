// ============================================
// Trends Over Time
// ============================================
//
// Phase 3 of CrossFit Insights. Three sub-metrics, each with its own series:
//
//   1. Strength — per-movement e1RM time series for `is1rmApplicable` lifts.
//   2. Speed    — per-benchmark times series for benchmarks logged ≥2x.
//                 Benchmarks logged only once recently surface as retest CTAs.
//   3. Volume   — weekly stacked workout counts per CrossFit domain plus
//                 cumulative working time.
//
// See claude_code_instructions/crossfit_smart_insights_spec.md §10.

import { db } from "@/db";
import {
  scores,
  scoreMovementDetails,
  workoutMovements,
  workouts,
  movements,
  benchmarkWorkouts,
} from "@/db/schema";
import { and, eq, gte, isNotNull } from "drizzle-orm";
import { normalizeSetEntries } from "@/lib/crossfit/set-entries";
import { estimatedOneRmForSet, parseRepScheme } from "./predicted-1rm";
import type { SetEntry } from "@/types/crossfit";
import type { DomainKey } from "./domain-profile";
import { DOMAIN_KEYS } from "./domain-profile";

const STRENGTH_WINDOW_DAYS = 365;
const BENCHMARK_WINDOW_DAYS = 365;
const RETEST_PROMPT_DAYS = 90;
const DEFAULT_VOLUME_WEEKS = 12;
const MIN_BENCHMARK_LOGS_FOR_TREND = 2;
const MAX_REPS_FOR_FORMULA = 10;

// ============================================
// Public types
// ============================================

export type StrengthTrendPoint = {
  date: string; // YYYY-MM-DD
  estimatedOneRm: number;
  weight: number;
  reps: number;
  isDirectTest: boolean;
};

export type StrengthTrend = {
  movementId: string;
  movementName: string;
  points: StrengthTrendPoint[]; // sorted asc by date
  bestE1rm: number;
  latestE1rm: number;
  firstE1rm: number;
  deltaLb: number; // latest − first
  changePct: number; // signed
};

export type BenchmarkTrendPoint = {
  scoreId: string;
  date: string;
  timeSeconds: number | null;
  totalReps: number | null;
  weightLbs: number | null;
  rounds: number | null;
  remainderReps: number | null;
  division: string;
  hitTimeCap: boolean;
};

export type BenchmarkTrend = {
  benchmarkId: string;
  benchmarkName: string;
  workoutType: string;
  timeCapSeconds: number | null;
  points: BenchmarkTrendPoint[]; // ≥2, sorted asc
  bestPoint: BenchmarkTrendPoint;
  latestPoint: BenchmarkTrendPoint;
  improved: boolean | null; // null when scoring metric ambiguous
};

export type BenchmarkRetest = {
  benchmarkId: string;
  benchmarkName: string;
  workoutType: string;
  lastDate: string;
  daysSinceLast: number;
  lastTimeSeconds: number | null;
};

export type VolumeWeek = {
  weekStart: string; // ISO date (Monday)
  weightlifting: number;
  gymnastics: number;
  monostructural: number;
  mixed: number;
  totalWorkouts: number;
  totalSeconds: number;
};

export type VolumeTrend = {
  weeks: VolumeWeek[]; // sorted asc
  totalWorkouts: number;
  totalSeconds: number;
  rangeWeeks: number;
};

export type TrendsResult = {
  strength: StrengthTrend[];
  benchmarks: BenchmarkTrend[];
  benchmarkRetests: BenchmarkRetest[];
  volume: VolumeTrend;
};

// ============================================
// Row types (exposed so tests can build fixtures DB-free)
// ============================================

export type StrengthTrendRow = {
  scoreId: string;
  workoutDate: string; // YYYY-MM-DD
  workoutRepScheme: string | null;
  movementId: string;
  movementName: string;
  actualWeight: number | null;
  setEntries: SetEntry[];
};

export type BenchmarkTrendRow = {
  scoreId: string;
  workoutDate: string;
  benchmarkId: string;
  benchmarkName: string;
  workoutType: string;
  timeCapSeconds: number | null;
  timeSeconds: number | null;
  totalReps: number | null;
  weightLbs: number | null;
  rounds: number | null;
  remainderReps: number | null;
  division: string;
  hitTimeCap: boolean;
};

export type VolumeTrendRow = {
  scoreId: string;
  workoutId: string;
  workoutDate: string;
  timeSeconds: number | null;
  timeCapSeconds: number | null;
  movementCategory: string;
  movementIsWeighted: boolean;
};

// ============================================
// Date helpers
// ============================================

function daysAgoFrom(from: Date, n: number): Date {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ISO Monday (00:00 UTC) for the week containing `iso`.
function weekStartIso(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dayOfWeek = d.getUTCDay(); // 0 = Sun
  const diffToMon = (dayOfWeek + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diffToMon);
  return toIsoDate(d);
}

function diffDays(fromIso: string, to: Date): number {
  const from = new Date(`${fromIso}T00:00:00Z`);
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
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

// ============================================
// Strength trends
// ============================================

async function fetchStrengthRows(
  userId: string,
  windowDays: number
): Promise<StrengthTrendRow[]> {
  const since = toIsoDate(daysAgoFrom(new Date(), windowDays));

  const rows = await db
    .select({
      scoreId: scores.id,
      workoutDate: workouts.workoutDate,
      workoutRepScheme: workouts.repScheme,
      movementId: movements.id,
      movementName: movements.canonicalName,
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
    scoreId: r.scoreId,
    workoutDate: r.workoutDate,
    workoutRepScheme: r.workoutRepScheme,
    movementId: r.movementId,
    movementName: r.movementName,
    actualWeight: r.actualWeight != null ? Number(r.actualWeight) : null,
    setEntries: normalizeSetEntries(r.setEntries),
  }));
}

// One row → at most one "best e1RM" point for that session. We collapse all
// sets within a single score down to the best e1RM rather than emitting one
// point per set, otherwise the chart goes spiky with warmup/back-off sets.
function rowToBestPoint(row: StrengthTrendRow): StrengthTrendPoint | null {
  const fallbackReps = parseRepScheme(row.workoutRepScheme);

  type Cand = { weight: number; reps: number; e1rm: number };
  const candidates: Cand[] = [];

  if (row.setEntries.length > 0) {
    for (const e of row.setEntries) {
      const reps = e.reps ?? fallbackReps ?? null;
      if (reps == null || reps < 1 || reps > MAX_REPS_FOR_FORMULA) continue;
      const e1rm = estimatedOneRmForSet(e.weight, reps);
      if (e1rm > 0) candidates.push({ weight: e.weight, reps, e1rm });
    }
  } else if (
    row.actualWeight != null &&
    row.actualWeight > 0 &&
    fallbackReps != null &&
    fallbackReps >= 1 &&
    fallbackReps <= MAX_REPS_FOR_FORMULA
  ) {
    const e1rm = estimatedOneRmForSet(row.actualWeight, fallbackReps);
    if (e1rm > 0) {
      candidates.push({ weight: row.actualWeight, reps: fallbackReps, e1rm });
    }
  }

  if (candidates.length === 0) return null;
  const best = candidates.reduce((a, b) => (b.e1rm > a.e1rm ? b : a));

  return {
    date: row.workoutDate,
    weight: best.weight,
    reps: best.reps,
    estimatedOneRm: Math.round(best.e1rm),
    isDirectTest: best.reps === 1,
  };
}

export function computeStrengthTrendsFromRows(
  rows: StrengthTrendRow[]
): StrengthTrend[] {
  // Group by movement, then collapse rows within the same score to a single
  // point (best e1RM in that session).
  const byMovement = new Map<
    string,
    { name: string; bestByScore: Map<string, StrengthTrendPoint> }
  >();

  for (const r of rows) {
    const point = rowToBestPoint(r);
    if (!point) continue;
    let group = byMovement.get(r.movementId);
    if (!group) {
      group = { name: r.movementName, bestByScore: new Map() };
      byMovement.set(r.movementId, group);
    }
    const cur = group.bestByScore.get(r.scoreId);
    if (!cur || point.estimatedOneRm > cur.estimatedOneRm) {
      group.bestByScore.set(r.scoreId, point);
    }
  }

  const out: StrengthTrend[] = [];
  for (const [movementId, group] of byMovement) {
    const points = Array.from(group.bestByScore.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );
    if (points.length === 0) continue;

    const first = points[0];
    const latest = points[points.length - 1];
    const best = points.reduce((a, b) =>
      b.estimatedOneRm > a.estimatedOneRm ? b : a
    );
    const deltaLb = latest.estimatedOneRm - first.estimatedOneRm;
    const changePct =
      first.estimatedOneRm > 0
        ? (deltaLb / first.estimatedOneRm) * 100
        : 0;

    out.push({
      movementId,
      movementName: group.name,
      points,
      bestE1rm: best.estimatedOneRm,
      latestE1rm: latest.estimatedOneRm,
      firstE1rm: first.estimatedOneRm,
      deltaLb,
      changePct,
    });
  }

  // Sort: most-logged (longest series) first, then highest current first.
  out.sort((a, b) => {
    if (b.points.length !== a.points.length) {
      return b.points.length - a.points.length;
    }
    return b.latestE1rm - a.latestE1rm;
  });

  return out;
}

export async function computeStrengthTrends(
  userId: string,
  opts?: { windowDays?: number }
): Promise<StrengthTrend[]> {
  const windowDays = opts?.windowDays ?? STRENGTH_WINDOW_DAYS;
  const rows = await fetchStrengthRows(userId, windowDays);
  return computeStrengthTrendsFromRows(rows);
}

// ============================================
// Benchmark (speed) trends
// ============================================

async function fetchBenchmarkRows(
  userId: string,
  windowDays: number
): Promise<BenchmarkTrendRow[]> {
  const since = toIsoDate(daysAgoFrom(new Date(), windowDays));

  const rows = await db
    .select({
      scoreId: scores.id,
      workoutDate: workouts.workoutDate,
      benchmarkId: benchmarkWorkouts.id,
      benchmarkName: benchmarkWorkouts.name,
      workoutType: workouts.workoutType,
      timeCapSeconds: workouts.timeCapSeconds,
      timeSeconds: scores.timeSeconds,
      totalReps: scores.totalReps,
      weightLbs: scores.weightLbs,
      rounds: scores.rounds,
      remainderReps: scores.remainderReps,
      division: scores.division,
      hitTimeCap: scores.hitTimeCap,
    })
    .from(scores)
    .innerJoin(workouts, eq(workouts.id, scores.workoutId))
    .innerJoin(
      benchmarkWorkouts,
      eq(benchmarkWorkouts.id, workouts.benchmarkWorkoutId)
    )
    .where(
      and(
        eq(scores.userId, userId),
        isNotNull(workouts.benchmarkWorkoutId),
        gte(workouts.workoutDate, since)
      )
    );

  return rows.map((r) => ({
    scoreId: r.scoreId,
    workoutDate: r.workoutDate,
    benchmarkId: r.benchmarkId,
    benchmarkName: r.benchmarkName,
    workoutType: r.workoutType,
    timeCapSeconds: r.timeCapSeconds,
    timeSeconds: r.timeSeconds,
    totalReps: r.totalReps,
    weightLbs: r.weightLbs != null ? Number(r.weightLbs) : null,
    rounds: r.rounds,
    remainderReps: r.remainderReps,
    division: r.division,
    hitTimeCap: r.hitTimeCap,
  }));
}

// Lower time = better for for_time/emom/tabata; higher reps/rounds/load = better
// for amrap/for_reps/for_load. Returns null when we can't tell.
function isBenchmarkBetter(
  row: BenchmarkTrendPoint,
  prev: BenchmarkTrendPoint,
  workoutType: string
): boolean | null {
  const t = workoutType;
  if (t === "for_time" || t === "emom" || t === "tabata") {
    if (row.timeSeconds == null || prev.timeSeconds == null) return null;
    return row.timeSeconds < prev.timeSeconds;
  }
  if (t === "amrap") {
    const a = (row.rounds ?? 0) * 1000 + (row.remainderReps ?? 0);
    const b = (prev.rounds ?? 0) * 1000 + (prev.remainderReps ?? 0);
    if (a === 0 && b === 0) return null;
    return a > b;
  }
  if (t === "for_reps" || t === "for_calories") {
    if (row.totalReps == null || prev.totalReps == null) return null;
    return row.totalReps > prev.totalReps;
  }
  if (t === "for_load" || t === "max_effort") {
    if (row.weightLbs == null || prev.weightLbs == null) return null;
    return row.weightLbs > prev.weightLbs;
  }
  return null;
}

function rowToBenchmarkPoint(row: BenchmarkTrendRow): BenchmarkTrendPoint {
  return {
    scoreId: row.scoreId,
    date: row.workoutDate,
    timeSeconds: row.timeSeconds,
    totalReps: row.totalReps,
    weightLbs: row.weightLbs,
    rounds: row.rounds,
    remainderReps: row.remainderReps,
    division: row.division,
    hitTimeCap: row.hitTimeCap,
  };
}

function pickBestPoint(
  points: BenchmarkTrendPoint[],
  workoutType: string
): BenchmarkTrendPoint {
  return points.reduce((best, p) => {
    const better = isBenchmarkBetter(p, best, workoutType);
    return better === true ? p : best;
  });
}

export function computeBenchmarkTrendsFromRows(
  rows: BenchmarkTrendRow[],
  opts?: { now?: Date; retestPromptDays?: number }
): { trends: BenchmarkTrend[]; retests: BenchmarkRetest[] } {
  const now = opts?.now ?? new Date();
  const retestDays = opts?.retestPromptDays ?? RETEST_PROMPT_DAYS;

  const byBenchmark = new Map<
    string,
    {
      name: string;
      workoutType: string;
      timeCapSeconds: number | null;
      rows: BenchmarkTrendRow[];
    }
  >();

  for (const r of rows) {
    let g = byBenchmark.get(r.benchmarkId);
    if (!g) {
      g = {
        name: r.benchmarkName,
        workoutType: r.workoutType,
        timeCapSeconds: r.timeCapSeconds,
        rows: [],
      };
      byBenchmark.set(r.benchmarkId, g);
    }
    g.rows.push(r);
  }

  const trends: BenchmarkTrend[] = [];
  const retests: BenchmarkRetest[] = [];

  for (const [benchmarkId, group] of byBenchmark) {
    const points = group.rows
      .map(rowToBenchmarkPoint)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (points.length >= MIN_BENCHMARK_LOGS_FOR_TREND) {
      const best = pickBestPoint(points, group.workoutType);
      const latest = points[points.length - 1];
      const first = points[0];
      const improved = isBenchmarkBetter(latest, first, group.workoutType);

      trends.push({
        benchmarkId,
        benchmarkName: group.name,
        workoutType: group.workoutType,
        timeCapSeconds: group.timeCapSeconds,
        points,
        bestPoint: best,
        latestPoint: latest,
        improved,
      });
      continue;
    }

    // Single log → retest CTA when stale.
    const only = points[0];
    const days = diffDays(only.date, now);
    if (days >= retestDays) {
      retests.push({
        benchmarkId,
        benchmarkName: group.name,
        workoutType: group.workoutType,
        lastDate: only.date,
        daysSinceLast: days,
        lastTimeSeconds: only.timeSeconds,
      });
    }
  }

  // Trends: most logged first, then most-recently-tested first.
  trends.sort((a, b) => {
    if (b.points.length !== a.points.length) {
      return b.points.length - a.points.length;
    }
    return b.latestPoint.date.localeCompare(a.latestPoint.date);
  });

  retests.sort((a, b) => b.daysSinceLast - a.daysSinceLast);

  return { trends, retests };
}

export async function computeBenchmarkTrends(
  userId: string,
  opts?: { windowDays?: number; now?: Date }
): Promise<{ trends: BenchmarkTrend[]; retests: BenchmarkRetest[] }> {
  const windowDays = opts?.windowDays ?? BENCHMARK_WINDOW_DAYS;
  const rows = await fetchBenchmarkRows(userId, windowDays);
  return computeBenchmarkTrendsFromRows(rows, opts);
}

// ============================================
// Volume trends
// ============================================

async function fetchVolumeRows(
  userId: string,
  weeks: number
): Promise<VolumeTrendRow[]> {
  // +6 days so the earliest week we want is fully included.
  const since = toIsoDate(daysAgoFrom(new Date(), weeks * 7 + 6));

  const rows = await db
    .select({
      scoreId: scores.id,
      workoutId: scores.workoutId,
      workoutDate: workouts.workoutDate,
      timeSeconds: scores.timeSeconds,
      timeCapSeconds: workouts.timeCapSeconds,
      movementCategory: movements.category,
      movementIsWeighted: movements.isWeighted,
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
    timeSeconds: r.timeSeconds,
    timeCapSeconds: r.timeCapSeconds,
    movementCategory: r.movementCategory,
    movementIsWeighted: r.movementIsWeighted,
  }));
}

export function computeVolumeTrendsFromRows(
  rows: VolumeTrendRow[],
  opts?: { now?: Date; weeks?: number }
): VolumeTrend {
  const now = opts?.now ?? new Date();
  const weeks = opts?.weeks ?? DEFAULT_VOLUME_WEEKS;

  // Build an empty bucket per week (oldest first).
  const todayMonday = weekStartIso(toIsoDate(now));
  const buckets = new Map<string, VolumeWeek>();
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(`${todayMonday}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i * 7);
    const iso = toIsoDate(d);
    buckets.set(iso, {
      weekStart: iso,
      weightlifting: 0,
      gymnastics: 0,
      monostructural: 0,
      mixed: 0,
      totalWorkouts: 0,
      totalSeconds: 0,
    });
  }

  // Index workouts → which domains appeared on them, plus working seconds.
  // We count one workout-per-domain per week, not movement-instances.
  type WorkoutAcc = {
    week: string;
    domains: Set<DomainKey>;
    timeSeconds: number; // capped per workout
  };
  const byWorkout = new Map<string, WorkoutAcc>();

  for (const r of rows) {
    const week = weekStartIso(r.workoutDate);
    if (!buckets.has(week)) continue; // outside window

    let acc = byWorkout.get(r.workoutId);
    if (!acc) {
      const seconds = (() => {
        if (r.timeSeconds == null) return 0;
        if (r.timeCapSeconds != null) {
          return Math.min(r.timeSeconds, r.timeCapSeconds);
        }
        return r.timeSeconds;
      })();
      acc = { week, domains: new Set(), timeSeconds: seconds };
      byWorkout.set(r.workoutId, acc);
    }
    acc.domains.add(bucketFor(r.movementCategory, r.movementIsWeighted));
  }

  // Roll up per-workout counts into per-week buckets.
  for (const acc of byWorkout.values()) {
    const bucket = buckets.get(acc.week);
    if (!bucket) continue;
    for (const d of acc.domains) {
      bucket[d] += 1;
    }
    bucket.totalWorkouts += 1;
    bucket.totalSeconds += acc.timeSeconds;
  }

  const sorted = Array.from(buckets.values()).sort((a, b) =>
    a.weekStart.localeCompare(b.weekStart)
  );

  let totalWorkouts = 0;
  let totalSeconds = 0;
  for (const w of sorted) {
    totalWorkouts += w.totalWorkouts;
    totalSeconds += w.totalSeconds;
  }

  return {
    weeks: sorted,
    totalWorkouts,
    totalSeconds,
    rangeWeeks: weeks,
  };
}

export async function computeVolumeTrends(
  userId: string,
  opts?: { weeks?: number; now?: Date }
): Promise<VolumeTrend> {
  const weeks = opts?.weeks ?? DEFAULT_VOLUME_WEEKS;
  const rows = await fetchVolumeRows(userId, weeks);
  return computeVolumeTrendsFromRows(rows, opts);
}

// ============================================
// Combined entry point used by the API
// ============================================

export async function computeTrends(
  userId: string,
  opts?: {
    strengthWindowDays?: number;
    benchmarkWindowDays?: number;
    volumeWeeks?: number;
    now?: Date;
  }
): Promise<TrendsResult> {
  const [strength, benchmarks, volume] = await Promise.all([
    computeStrengthTrends(userId, {
      windowDays: opts?.strengthWindowDays,
    }),
    computeBenchmarkTrends(userId, {
      windowDays: opts?.benchmarkWindowDays,
      now: opts?.now,
    }),
    computeVolumeTrends(userId, {
      weeks: opts?.volumeWeeks,
      now: opts?.now,
    }),
  ]);

  return {
    strength,
    benchmarks: benchmarks.trends,
    benchmarkRetests: benchmarks.retests,
    volume,
  };
}

// Re-exported so consumers don't need to reach into domain-profile.
export { DOMAIN_KEYS };
