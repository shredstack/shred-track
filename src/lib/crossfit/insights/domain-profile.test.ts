import { describe, it, expect } from "vitest";
import {
  computeDomainProfileFromRows,
  type DomainProfileRow,
} from "./domain-profile";
import type { SetEntry } from "@/types/crossfit";

// Reference "now" for deterministic windowing. Pick something well past 2026 so
// the test fixtures (which use 2026 dates) all land cleanly in the window.
const NOW = new Date("2026-04-29T12:00:00Z");

function isoDaysAgo(n: number): string {
  const d = new Date(NOW.getTime());
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

let nextRowId = 0;

function row(partial: Partial<DomainProfileRow>): DomainProfileRow {
  nextRowId += 1;
  return {
    scoreId: partial.scoreId ?? `score-${nextRowId}`,
    workoutId: partial.workoutId ?? `workout-${nextRowId}`,
    workoutDate: partial.workoutDate ?? isoDaysAgo(10),
    workoutType: partial.workoutType ?? "for_time",
    workoutRepScheme: partial.workoutRepScheme ?? null,
    movementId: partial.movementId ?? "movement-default",
    movementCategory: partial.movementCategory ?? "barbell",
    movementIsWeighted: partial.movementIsWeighted ?? true,
    movementIs1rmApplicable: partial.movementIs1rmApplicable ?? false,
    wasRx: partial.wasRx ?? true,
    actualWeight: partial.actualWeight ?? null,
    setEntries: partial.setEntries ?? [],
  };
}

function findDomain(profile: ReturnType<typeof computeDomainProfileFromRows>, key: string) {
  const d = profile.domains.find((dd) => dd.domain === key);
  if (!d) throw new Error(`domain ${key} missing from profile`);
  return d;
}

describe("computeDomainProfileFromRows", () => {
  it("returns empty / hasEnoughData=false for an athlete with no rows", () => {
    const profile = computeDomainProfileFromRows([], { now: NOW });

    expect(profile.totalScores).toBe(0);
    expect(profile.totalDistinctWorkouts).toBe(0);
    expect(profile.hasEnoughData).toBe(false);
    expect(profile.strongDomain).toBeNull();
    expect(profile.weakDomain).toBeNull();
    for (const d of profile.domains) {
      expect(d.volumeScore).toBe(0);
      expect(d.scalingRate).toBe(0);
      expect(d.relativeEmphasis).toBe(0);
      expect(d.movementInstances).toBe(0);
    }
  });

  it("flags hasEnoughData=false when span < 8 weeks even with rows", () => {
    const rows = [
      row({ workoutDate: isoDaysAgo(40) }),
      row({ workoutDate: isoDaysAgo(35) }),
      row({ workoutDate: isoDaysAgo(30) }),
    ];
    const profile = computeDomainProfileFromRows(rows, { now: NOW });
    expect(profile.scoringSpanDays).toBe(10);
    expect(profile.hasEnoughData).toBe(false);
  });

  it("flags hasEnoughData=true when span >= 8 weeks", () => {
    const rows = [
      row({ workoutDate: isoDaysAgo(85) }),
      row({ workoutDate: isoDaysAgo(50) }),
      row({ workoutDate: isoDaysAgo(20) }),
    ];
    const profile = computeDomainProfileFromRows(rows, { now: NOW });
    expect(profile.scoringSpanDays).toBe(65);
    expect(profile.hasEnoughData).toBe(true);
  });

  it("buckets categories per spec §9.2", () => {
    const cases: Array<{
      category: string;
      isWeighted: boolean;
      expected: string;
    }> = [
      { category: "barbell", isWeighted: true, expected: "weightlifting" },
      { category: "dumbbell", isWeighted: true, expected: "weightlifting" },
      { category: "kettlebell", isWeighted: true, expected: "weightlifting" },
      { category: "kettlebell", isWeighted: false, expected: "mixed" },
      { category: "gymnastics", isWeighted: false, expected: "gymnastics" },
      { category: "bodyweight", isWeighted: false, expected: "gymnastics" },
      { category: "monostructural", isWeighted: false, expected: "monostructural" },
      { category: "accessory", isWeighted: false, expected: "mixed" },
      { category: "other", isWeighted: false, expected: "mixed" },
    ];

    for (const c of cases) {
      const r = row({
        movementCategory: c.category,
        movementIsWeighted: c.isWeighted,
        workoutDate: isoDaysAgo(10),
      });
      const profile = computeDomainProfileFromRows([r], { now: NOW });
      const counts = Object.fromEntries(
        profile.domains.map((d) => [d.domain, d.movementInstances])
      );
      expect(
        counts[c.expected],
        `${c.category} (weighted=${c.isWeighted}) → ${c.expected}`
      ).toBe(1);
    }
  });

  it("counts each workout once per domain regardless of movement count", () => {
    // Same workout, three barbell movements → volumeScore = 1.
    const rows = [
      row({ workoutId: "w1", scoreId: "s1", workoutDate: isoDaysAgo(20), movementId: "m1", movementCategory: "barbell" }),
      row({ workoutId: "w1", scoreId: "s1", workoutDate: isoDaysAgo(20), movementId: "m2", movementCategory: "barbell" }),
      row({ workoutId: "w1", scoreId: "s1", workoutDate: isoDaysAgo(20), movementId: "m3", movementCategory: "barbell" }),
    ];
    const profile = computeDomainProfileFromRows(rows, { now: NOW });
    const wl = findDomain(profile, "weightlifting");
    expect(wl.volumeScore).toBe(1);
    expect(wl.movementInstances).toBe(3);
  });

  it("computes scaling rate as scaled / total instances per domain", () => {
    const rows = [
      row({ wasRx: true, movementCategory: "gymnastics", movementIsWeighted: false, workoutDate: isoDaysAgo(10), workoutId: "w1", scoreId: "s1", movementId: "m1" }),
      row({ wasRx: false, movementCategory: "gymnastics", movementIsWeighted: false, workoutDate: isoDaysAgo(10), workoutId: "w1", scoreId: "s1", movementId: "m2" }),
      row({ wasRx: false, movementCategory: "gymnastics", movementIsWeighted: false, workoutDate: isoDaysAgo(15), workoutId: "w2", scoreId: "s2", movementId: "m1" }),
      row({ wasRx: false, movementCategory: "gymnastics", movementIsWeighted: false, workoutDate: isoDaysAgo(20), workoutId: "w3", scoreId: "s3", movementId: "m1" }),
    ];
    const profile = computeDomainProfileFromRows(rows, { now: NOW });
    const gym = findDomain(profile, "gymnastics");
    expect(gym.movementInstances).toBe(4);
    expect(gym.scaledInstances).toBe(3);
    expect(gym.scalingRate).toBeCloseTo(0.75);
  });

  it("computes relative emphasis as volumeScore / sum across domains", () => {
    const rows = [
      // 2 weightlifting workouts
      row({ movementCategory: "barbell", workoutId: "w1", scoreId: "s1", workoutDate: isoDaysAgo(10) }),
      row({ movementCategory: "barbell", workoutId: "w2", scoreId: "s2", workoutDate: isoDaysAgo(15) }),
      // 1 gymnastics workout
      row({ movementCategory: "gymnastics", movementIsWeighted: false, workoutId: "w3", scoreId: "s3", workoutDate: isoDaysAgo(20) }),
      // 1 mono workout
      row({ movementCategory: "monostructural", movementIsWeighted: false, workoutId: "w4", scoreId: "s4", workoutDate: isoDaysAgo(25) }),
    ];
    const profile = computeDomainProfileFromRows(rows, { now: NOW });
    expect(findDomain(profile, "weightlifting").relativeEmphasis).toBeCloseTo(0.5);
    expect(findDomain(profile, "gymnastics").relativeEmphasis).toBeCloseTo(0.25);
    expect(findDomain(profile, "monostructural").relativeEmphasis).toBeCloseTo(0.25);
    expect(findDomain(profile, "mixed").relativeEmphasis).toBe(0);
  });

  it("excludes domains with zero movement instances from strong/weak ranking", () => {
    // Athlete who only logs gymnastics — should be strong, not weak.
    const rows = [
      row({ movementCategory: "gymnastics", movementIsWeighted: false, workoutId: "w1", scoreId: "s1", workoutDate: isoDaysAgo(10), wasRx: true }),
      row({ movementCategory: "gymnastics", movementIsWeighted: false, workoutId: "w2", scoreId: "s2", workoutDate: isoDaysAgo(20), wasRx: true }),
    ];
    const profile = computeDomainProfileFromRows(rows, { now: NOW });
    expect(profile.strongDomain).toBe("gymnastics");
    // Only one present domain — no meaningful "weakest".
    expect(profile.weakDomain).toBeNull();
  });

  it("picks the strongest domain by emphasis × (1 − scalingRate)", () => {
    // Weightlifting: 3 workouts, all RX (scalingRate=0)
    // Gymnastics: 1 workout, all scaled (scalingRate=1)
    // Mono: 1 workout, all RX
    const rows = [
      row({ movementCategory: "barbell", workoutId: "w1", scoreId: "s1", workoutDate: isoDaysAgo(10), wasRx: true }),
      row({ movementCategory: "barbell", workoutId: "w2", scoreId: "s2", workoutDate: isoDaysAgo(15), wasRx: true }),
      row({ movementCategory: "barbell", workoutId: "w3", scoreId: "s3", workoutDate: isoDaysAgo(20), wasRx: true }),
      row({ movementCategory: "gymnastics", movementIsWeighted: false, workoutId: "w4", scoreId: "s4", workoutDate: isoDaysAgo(25), wasRx: false }),
      row({ movementCategory: "monostructural", movementIsWeighted: false, workoutId: "w5", scoreId: "s5", workoutDate: isoDaysAgo(30), wasRx: true }),
    ];
    const profile = computeDomainProfileFromRows(rows, { now: NOW });
    expect(profile.strongDomain).toBe("weightlifting");
    expect(profile.weakDomain).toBe("gymnastics");
  });

  it("partitions current vs prior windows at the 90-day boundary", () => {
    const rows = [
      // current window
      row({ movementCategory: "barbell", workoutId: "w1", scoreId: "s1", workoutDate: isoDaysAgo(10) }),
      row({ movementCategory: "barbell", workoutId: "w2", scoreId: "s2", workoutDate: isoDaysAgo(80) }),
      // prior window
      row({ movementCategory: "barbell", workoutId: "w3", scoreId: "s3", workoutDate: isoDaysAgo(120) }),
      row({ movementCategory: "barbell", workoutId: "w4", scoreId: "s4", workoutDate: isoDaysAgo(170) }),
    ];
    const profile = computeDomainProfileFromRows(rows, { now: NOW });
    const wl = findDomain(profile, "weightlifting");
    expect(wl.volumeScore).toBe(2);
    expect(wl.priorVolumeScore).toBe(2);
  });

  it("reports volume progression direction & magnitude", () => {
    const rows = [
      // 4 in current, 2 in prior → up ~100%
      row({ movementCategory: "barbell", workoutId: "wc1", scoreId: "sc1", workoutDate: isoDaysAgo(10) }),
      row({ movementCategory: "barbell", workoutId: "wc2", scoreId: "sc2", workoutDate: isoDaysAgo(20) }),
      row({ movementCategory: "barbell", workoutId: "wc3", scoreId: "sc3", workoutDate: isoDaysAgo(40) }),
      row({ movementCategory: "barbell", workoutId: "wc4", scoreId: "sc4", workoutDate: isoDaysAgo(80) }),
      row({ movementCategory: "barbell", workoutId: "wp1", scoreId: "sp1", workoutDate: isoDaysAgo(120) }),
      row({ movementCategory: "barbell", workoutId: "wp2", scoreId: "sp2", workoutDate: isoDaysAgo(170) }),
    ];
    const profile = computeDomainProfileFromRows(rows, { now: NOW });
    const wl = findDomain(profile, "weightlifting");
    const vol = wl.progression.find((p) => p.metric === "volume");
    expect(vol).toBeDefined();
    expect(vol!.current).toBe(4);
    expect(vol!.prior).toBe(2);
    expect(vol!.direction).toBe("up");
    expect(vol!.magnitudePct).toBeCloseTo(100);
  });

  it("inverts scaling-rate direction (lower current = better = up)", () => {
    // Gymnastics: prior 4 instances all scaled (rate=1.0), current 4 instances 1 scaled (rate=0.25).
    // Lower scaling rate = better → direction='up'.
    const make = (
      i: number,
      isCurrent: boolean,
      scaled: boolean
    ): DomainProfileRow =>
      row({
        movementCategory: "gymnastics",
        movementIsWeighted: false,
        workoutId: `${isCurrent ? "wc" : "wp"}${i}`,
        scoreId: `${isCurrent ? "sc" : "sp"}${i}`,
        movementId: `m${i}`,
        workoutDate: isoDaysAgo(isCurrent ? 10 + i * 5 : 110 + i * 5),
        wasRx: !scaled,
      });

    const rows = [
      make(1, true, true),
      make(2, true, false),
      make(3, true, false),
      make(4, true, false),
      make(5, false, true),
      make(6, false, true),
      make(7, false, true),
      make(8, false, true),
    ];
    const profile = computeDomainProfileFromRows(rows, { now: NOW });
    const gym = findDomain(profile, "gymnastics");
    const sr = gym.progression.find((p) => p.metric === "scaling_rate");
    expect(sr).toBeDefined();
    expect(sr!.current).toBeCloseTo(0.25);
    expect(sr!.prior).toBeCloseTo(1.0);
    expect(sr!.direction).toBe("up");
  });

  it("computes avg e1RM progression for weightlifting (overlapping movements)", () => {
    const setsCurrent: SetEntry[] = [{ weight: 250, reps: 5 }];
    const setsPrior: SetEntry[] = [{ weight: 225, reps: 5 }];

    const rows = [
      // movement A — present in both windows (back squat)
      row({
        movementId: "mA",
        movementCategory: "barbell",
        movementIs1rmApplicable: true,
        workoutId: "w1",
        scoreId: "s1",
        workoutDate: isoDaysAgo(20),
        setEntries: setsCurrent,
      }),
      row({
        movementId: "mA",
        movementCategory: "barbell",
        movementIs1rmApplicable: true,
        workoutId: "w2",
        scoreId: "s2",
        workoutDate: isoDaysAgo(150),
        setEntries: setsPrior,
      }),
    ];
    const profile = computeDomainProfileFromRows(rows, { now: NOW });
    const wl = findDomain(profile, "weightlifting");
    const e1rm = wl.progression.find((p) => p.metric === "avg_e1rm");
    expect(e1rm).toBeDefined();
    expect(e1rm!.current).toBeGreaterThan(e1rm!.prior!);
    expect(e1rm!.direction).toBe("up");
  });

  it("omits avg_e1rm when no movement overlaps between windows", () => {
    const rows = [
      // Different movements in each window — no overlap.
      row({
        movementId: "mA",
        movementCategory: "barbell",
        movementIs1rmApplicable: true,
        workoutId: "w1",
        scoreId: "s1",
        workoutDate: isoDaysAgo(20),
        setEntries: [{ weight: 250, reps: 5 }],
      }),
      row({
        movementId: "mB",
        movementCategory: "barbell",
        movementIs1rmApplicable: true,
        workoutId: "w2",
        scoreId: "s2",
        workoutDate: isoDaysAgo(150),
        setEntries: [{ weight: 200, reps: 5 }],
      }),
    ];
    const profile = computeDomainProfileFromRows(rows, { now: NOW });
    const wl = findDomain(profile, "weightlifting");
    expect(wl.progression.find((p) => p.metric === "avg_e1rm")).toBeUndefined();
  });

  it("suppresses scaling_rate progression when both windows have <4 combined instances", () => {
    const rows = [
      row({ movementCategory: "barbell", workoutId: "w1", scoreId: "s1", workoutDate: isoDaysAgo(10), wasRx: true }),
      row({ movementCategory: "barbell", workoutId: "w2", scoreId: "s2", workoutDate: isoDaysAgo(120), wasRx: false }),
    ];
    const profile = computeDomainProfileFromRows(rows, { now: NOW });
    const wl = findDomain(profile, "weightlifting");
    expect(wl.progression.find((p) => p.metric === "scaling_rate")).toBeUndefined();
  });
});
