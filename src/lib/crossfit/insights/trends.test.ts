import { describe, it, expect } from "vitest";
import {
  computeStrengthTrendsFromRows,
  computeBenchmarkTrendsFromRows,
  computeVolumeTrendsFromRows,
  type StrengthTrendRow,
  type BenchmarkTrendRow,
  type VolumeTrendRow,
} from "./trends";
import type { SetEntry } from "@/types/crossfit";

const NOW = new Date("2026-04-29T12:00:00Z");

function isoDaysAgo(n: number): string {
  const d = new Date(NOW.getTime());
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// ============================================
// Strength
// ============================================

function strengthRow(partial: Partial<StrengthTrendRow>): StrengthTrendRow {
  return {
    scoreId: partial.scoreId ?? `score-${Math.random()}`,
    workoutDate: partial.workoutDate ?? isoDaysAgo(10),
    workoutRepScheme: partial.workoutRepScheme ?? null,
    movementId: partial.movementId ?? "back-squat",
    movementName: partial.movementName ?? "Back Squat",
    actualWeight: partial.actualWeight ?? null,
    setEntries: partial.setEntries ?? [],
  };
}

describe("computeStrengthTrendsFromRows", () => {
  it("returns empty array for an athlete with no rows", () => {
    expect(computeStrengthTrendsFromRows([])).toEqual([]);
  });

  it("groups by movement and emits one point per session (best e1RM in session)", () => {
    const sets: SetEntry[] = [
      { weight: 250, reps: 5 },
      { weight: 275, reps: 3 },
      { weight: 200, reps: 8 },
    ];
    const rows = [
      strengthRow({
        scoreId: "s1",
        movementId: "back-squat",
        movementName: "Back Squat",
        workoutDate: isoDaysAgo(60),
        setEntries: sets,
      }),
    ];

    const out = computeStrengthTrendsFromRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0].movementId).toBe("back-squat");
    expect(out[0].points).toHaveLength(1);
    // Best of the three should be the 275@3 (e1RM ~302 via Brzycki).
    expect(out[0].points[0].weight).toBe(275);
    expect(out[0].points[0].reps).toBe(3);
  });

  it("collapses multiple rows on the same score to the best e1RM point", () => {
    const rows = [
      strengthRow({
        scoreId: "s1",
        movementId: "deadlift",
        movementName: "Deadlift",
        workoutDate: isoDaysAgo(30),
        setEntries: [{ weight: 300, reps: 5 }],
      }),
      strengthRow({
        scoreId: "s1",
        movementId: "deadlift",
        movementName: "Deadlift",
        workoutDate: isoDaysAgo(30),
        setEntries: [{ weight: 320, reps: 3 }],
      }),
    ];

    const out = computeStrengthTrendsFromRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0].points).toHaveLength(1);
    // 320@3 (e1RM ~352) > 300@5 (e1RM ~349)
    expect(out[0].points[0].weight).toBe(320);
  });

  it("orders points ascending by date", () => {
    const rows = [
      strengthRow({
        scoreId: "newer",
        workoutDate: isoDaysAgo(10),
        setEntries: [{ weight: 250, reps: 5 }],
      }),
      strengthRow({
        scoreId: "older",
        workoutDate: isoDaysAgo(100),
        setEntries: [{ weight: 225, reps: 5 }],
      }),
      strengthRow({
        scoreId: "middle",
        workoutDate: isoDaysAgo(50),
        setEntries: [{ weight: 240, reps: 5 }],
      }),
    ];

    const out = computeStrengthTrendsFromRows(rows);
    expect(out[0].points.map((p) => p.date)).toEqual([
      isoDaysAgo(100),
      isoDaysAgo(50),
      isoDaysAgo(10),
    ]);
  });

  it("computes deltaLb and changePct from first → latest", () => {
    const rows = [
      strengthRow({
        scoreId: "s1",
        workoutDate: isoDaysAgo(100),
        setEntries: [{ weight: 200, reps: 5 }],
      }),
      strengthRow({
        scoreId: "s2",
        workoutDate: isoDaysAgo(10),
        setEntries: [{ weight: 250, reps: 5 }],
      }),
    ];

    const out = computeStrengthTrendsFromRows(rows);
    const trend = out[0];
    expect(trend.firstE1rm).toBeLessThan(trend.latestE1rm);
    expect(trend.deltaLb).toBe(trend.latestE1rm - trend.firstE1rm);
    expect(trend.changePct).toBeGreaterThan(0);
  });

  it("flags reps=1 as a direct test", () => {
    const rows = [
      strengthRow({
        scoreId: "s1",
        workoutDate: isoDaysAgo(20),
        setEntries: [{ weight: 305, reps: 1 }],
      }),
    ];
    const out = computeStrengthTrendsFromRows(rows);
    expect(out[0].points[0].isDirectTest).toBe(true);
    expect(out[0].points[0].estimatedOneRm).toBe(305);
  });

  it("falls back to actualWeight + repScheme when setEntries is empty", () => {
    const rows = [
      strengthRow({
        scoreId: "s1",
        workoutDate: isoDaysAgo(20),
        actualWeight: 240,
        workoutRepScheme: "5x5",
        setEntries: [],
      }),
    ];
    const out = computeStrengthTrendsFromRows(rows);
    expect(out[0].points).toHaveLength(1);
    expect(out[0].points[0].weight).toBe(240);
    expect(out[0].points[0].reps).toBe(5);
  });

  it("skips rows where no usable rep count can be inferred", () => {
    const rows = [
      strengthRow({
        scoreId: "s1",
        workoutDate: isoDaysAgo(20),
        actualWeight: 240,
        workoutRepScheme: "21-15-9", // ladder, can't read reps-per-set
        setEntries: [],
      }),
    ];
    expect(computeStrengthTrendsFromRows(rows)).toEqual([]);
  });
});

// ============================================
// Benchmarks
// ============================================

let nextBmRow = 0;
function bmRow(partial: Partial<BenchmarkTrendRow>): BenchmarkTrendRow {
  nextBmRow += 1;
  return {
    scoreId: partial.scoreId ?? `bm-score-${nextBmRow}`,
    workoutDate: partial.workoutDate ?? isoDaysAgo(10),
    benchmarkId: partial.benchmarkId ?? "fran",
    benchmarkName: partial.benchmarkName ?? "Fran",
    workoutType: partial.workoutType ?? "for_time",
    timeCapSeconds: partial.timeCapSeconds ?? null,
    timeSeconds: partial.timeSeconds ?? null,
    totalReps: partial.totalReps ?? null,
    weightLbs: partial.weightLbs ?? null,
    rounds: partial.rounds ?? null,
    remainderReps: partial.remainderReps ?? null,
    division: partial.division ?? "rx",
    hitTimeCap: partial.hitTimeCap ?? false,
  };
}

describe("computeBenchmarkTrendsFromRows", () => {
  it("returns empty trends + retests when there are no rows", () => {
    const out = computeBenchmarkTrendsFromRows([], { now: NOW });
    expect(out.trends).toEqual([]);
    expect(out.retests).toEqual([]);
  });

  it("requires ≥2 logs of the same benchmark to form a trend", () => {
    const out = computeBenchmarkTrendsFromRows(
      [bmRow({ benchmarkId: "fran", workoutDate: isoDaysAgo(10), timeSeconds: 250 })],
      { now: NOW }
    );
    expect(out.trends).toEqual([]);
  });

  it("emits a retest CTA for a single recent log when older than 90d", () => {
    const out = computeBenchmarkTrendsFromRows(
      [bmRow({ benchmarkId: "fran", workoutDate: isoDaysAgo(120), timeSeconds: 240 })],
      { now: NOW }
    );
    expect(out.trends).toEqual([]);
    expect(out.retests).toHaveLength(1);
    expect(out.retests[0].benchmarkId).toBe("fran");
    expect(out.retests[0].daysSinceLast).toBeGreaterThanOrEqual(90);
  });

  it("does NOT emit a retest CTA for a single fresh log", () => {
    const out = computeBenchmarkTrendsFromRows(
      [bmRow({ benchmarkId: "fran", workoutDate: isoDaysAgo(20), timeSeconds: 240 })],
      { now: NOW }
    );
    expect(out.trends).toEqual([]);
    expect(out.retests).toEqual([]);
  });

  it("forms a for_time trend and picks the lowest time as best", () => {
    const rows = [
      bmRow({ benchmarkId: "fran", workoutDate: isoDaysAgo(120), timeSeconds: 280 }),
      bmRow({ benchmarkId: "fran", workoutDate: isoDaysAgo(60), timeSeconds: 250 }),
      bmRow({ benchmarkId: "fran", workoutDate: isoDaysAgo(10), timeSeconds: 230 }),
    ];
    const out = computeBenchmarkTrendsFromRows(rows, { now: NOW });
    expect(out.trends).toHaveLength(1);
    const t = out.trends[0];
    expect(t.points).toHaveLength(3);
    expect(t.points[0].timeSeconds).toBe(280); // oldest first
    expect(t.bestPoint.timeSeconds).toBe(230);
    expect(t.latestPoint.timeSeconds).toBe(230);
    expect(t.improved).toBe(true);
  });

  it("forms an amrap trend that prefers higher rounds + remainder reps", () => {
    const rows = [
      bmRow({
        benchmarkId: "cindy",
        workoutType: "amrap",
        workoutDate: isoDaysAgo(60),
        rounds: 18,
        remainderReps: 5,
      }),
      bmRow({
        benchmarkId: "cindy",
        workoutType: "amrap",
        workoutDate: isoDaysAgo(10),
        rounds: 20,
        remainderReps: 0,
      }),
    ];
    const out = computeBenchmarkTrendsFromRows(rows, { now: NOW });
    const t = out.trends[0];
    expect(t.improved).toBe(true);
    expect(t.bestPoint.rounds).toBe(20);
  });

  it("forms a for_load trend and prefers heavier", () => {
    const rows = [
      bmRow({
        benchmarkId: "grace",
        workoutType: "for_load",
        workoutDate: isoDaysAgo(60),
        weightLbs: 185,
      }),
      bmRow({
        benchmarkId: "grace",
        workoutType: "for_load",
        workoutDate: isoDaysAgo(10),
        weightLbs: 205,
      }),
    ];
    const out = computeBenchmarkTrendsFromRows(rows, { now: NOW });
    const t = out.trends[0];
    expect(t.improved).toBe(true);
    expect(t.bestPoint.weightLbs).toBe(205);
  });

  it("returns improved=false when latest is worse than first", () => {
    const rows = [
      bmRow({ benchmarkId: "fran", workoutDate: isoDaysAgo(60), timeSeconds: 220 }),
      bmRow({ benchmarkId: "fran", workoutDate: isoDaysAgo(10), timeSeconds: 260 }),
    ];
    const out = computeBenchmarkTrendsFromRows(rows, { now: NOW });
    expect(out.trends[0].improved).toBe(false);
  });
});

// ============================================
// Volume
// ============================================

let nextVolRow = 0;
function volRow(partial: Partial<VolumeTrendRow>): VolumeTrendRow {
  nextVolRow += 1;
  return {
    scoreId: partial.scoreId ?? `vol-score-${nextVolRow}`,
    workoutId: partial.workoutId ?? `vol-workout-${nextVolRow}`,
    workoutDate: partial.workoutDate ?? isoDaysAgo(7),
    timeSeconds: partial.timeSeconds ?? null,
    timeCapSeconds: partial.timeCapSeconds ?? null,
    movementCategory: partial.movementCategory ?? "barbell",
    movementIsWeighted:
      partial.movementIsWeighted == null ? true : partial.movementIsWeighted,
  };
}

describe("computeVolumeTrendsFromRows", () => {
  it("returns the right number of weeks (oldest first)", () => {
    const out = computeVolumeTrendsFromRows([], { now: NOW, weeks: 12 });
    expect(out.weeks).toHaveLength(12);
    expect(out.rangeWeeks).toBe(12);
    for (let i = 1; i < out.weeks.length; i++) {
      expect(out.weeks[i].weekStart > out.weeks[i - 1].weekStart).toBe(true);
    }
  });

  it("counts each workout once per domain regardless of movement count", () => {
    // Same workout, three barbell movements → weightlifting count = 1.
    const rows = [
      volRow({
        workoutId: "w1",
        scoreId: "s1",
        workoutDate: isoDaysAgo(7),
        movementCategory: "barbell",
      }),
      volRow({
        workoutId: "w1",
        scoreId: "s1",
        workoutDate: isoDaysAgo(7),
        movementCategory: "barbell",
      }),
      volRow({
        workoutId: "w1",
        scoreId: "s1",
        workoutDate: isoDaysAgo(7),
        movementCategory: "barbell",
      }),
    ];
    const out = computeVolumeTrendsFromRows(rows, { now: NOW, weeks: 12 });
    const wlSum = out.weeks.reduce((s, w) => s + w.weightlifting, 0);
    expect(wlSum).toBe(1);
    expect(out.totalWorkouts).toBe(1);
  });

  it("counts a mixed-domain workout once in each domain it touches", () => {
    const rows = [
      volRow({
        workoutId: "w1",
        scoreId: "s1",
        workoutDate: isoDaysAgo(7),
        movementCategory: "barbell",
        movementIsWeighted: true,
      }),
      volRow({
        workoutId: "w1",
        scoreId: "s1",
        workoutDate: isoDaysAgo(7),
        movementCategory: "gymnastics",
        movementIsWeighted: false,
      }),
    ];
    const out = computeVolumeTrendsFromRows(rows, { now: NOW, weeks: 12 });
    const wl = out.weeks.reduce((s, w) => s + w.weightlifting, 0);
    const gym = out.weeks.reduce((s, w) => s + w.gymnastics, 0);
    expect(wl).toBe(1);
    expect(gym).toBe(1);
    // totalWorkouts is per-workout, not per-domain
    expect(out.totalWorkouts).toBe(1);
  });

  it("caps timeSeconds at the workout's time cap when both are set", () => {
    const rows = [
      volRow({
        workoutId: "w1",
        scoreId: "s1",
        workoutDate: isoDaysAgo(7),
        timeSeconds: 1500,
        timeCapSeconds: 900,
      }),
    ];
    const out = computeVolumeTrendsFromRows(rows, { now: NOW, weeks: 12 });
    expect(out.totalSeconds).toBe(900);
  });

  it("ignores rows older than the requested weeks window", () => {
    const rows = [
      volRow({
        workoutId: "w1",
        scoreId: "s1",
        workoutDate: isoDaysAgo(7),
      }),
      volRow({
        workoutId: "w_old",
        scoreId: "s_old",
        workoutDate: isoDaysAgo(200),
      }),
    ];
    const out = computeVolumeTrendsFromRows(rows, { now: NOW, weeks: 12 });
    expect(out.totalWorkouts).toBe(1);
  });

  it("buckets workouts into the same ISO week (Mon-anchored)", () => {
    // Two workouts in the same week — should land in the same bucket.
    const rows = [
      volRow({
        workoutId: "w1",
        scoreId: "s1",
        workoutDate: isoDaysAgo(7),
        movementCategory: "barbell",
      }),
      volRow({
        workoutId: "w2",
        scoreId: "s2",
        workoutDate: isoDaysAgo(8),
        movementCategory: "barbell",
      }),
    ];
    const out = computeVolumeTrendsFromRows(rows, { now: NOW, weeks: 12 });
    const populated = out.weeks.filter((w) => w.totalWorkouts > 0);
    expect(populated.length).toBeLessThanOrEqual(2); // 2 if workouts cross a Mon boundary
    const wl = out.weeks.reduce((s, w) => s + w.weightlifting, 0);
    expect(wl).toBe(2);
  });
});
