import { describe, expect, it } from "vitest";
import {
  estimateOneRm,
  pickBestEstimate,
  shouldRejectSet,
} from "./one-rep-max-estimator";

describe("shouldRejectSet", () => {
  it("rejects out-of-range reps", () => {
    expect(shouldRejectSet({ weightLb: 95, reps: 0 })).toBe(true);
    expect(shouldRejectSet({ weightLb: 95, reps: 15 })).toBe(true);
    expect(shouldRejectSet({ weightLb: 95, reps: 5 })).toBe(false);
  });

  it("rejects scaled 1RM-applicable sets", () => {
    expect(
      shouldRejectSet({
        weightLb: 95,
        reps: 5,
        wasRx: false,
        is1rmApplicable: true,
      })
    ).toBe(true);
    expect(
      shouldRejectSet({
        weightLb: 95,
        reps: 5,
        wasRx: false,
        is1rmApplicable: false,
      })
    ).toBe(false);
  });

  it("rejects RPE ≤ 5 (pacing weight)", () => {
    expect(shouldRejectSet({ weightLb: 95, reps: 5, rpe: 5 })).toBe(true);
    expect(shouldRejectSet({ weightLb: 95, reps: 5, rpe: 7 })).toBe(false);
  });

  it("rejects sub-30% bodyweight on major lifts (warm-up)", () => {
    // 50 / 200 = 0.25 → warm-up territory for a major lift.
    expect(
      shouldRejectSet({
        weightLb: 50,
        reps: 5,
        athleteBodyweightLb: 200,
        isMajorLift: true,
      })
    ).toBe(true);
    // Same load on a non-major-lift movement is fine.
    expect(
      shouldRejectSet({
        weightLb: 50,
        reps: 5,
        athleteBodyweightLb: 200,
        isMajorLift: false,
      })
    ).toBe(false);
  });
});

describe("estimateOneRm", () => {
  it("Brzycki for reps ≤ 5: 5 × 200 lb → 225 lb", () => {
    // 200 × 36 / (37 − 5) = 225
    expect(estimateOneRm({ weightLb: 200, reps: 5 })).toEqual({
      estimated1rmLb: 225,
      method: "brzycki_from_set",
    });
  });

  it("Epley for reps 6–10: 8 × 185 lb → ~234 lb", () => {
    // 185 × (1 + 8/30) = 234.33 → rounds to 234.5
    expect(estimateOneRm({ weightLb: 185, reps: 8 })).toEqual({
      estimated1rmLb: 234.5,
      method: "epley_from_set",
    });
  });

  it("single at RPE 8+ (or no RPE) is treated as logged_1rm", () => {
    expect(estimateOneRm({ weightLb: 305, reps: 1, rpe: 9 })).toEqual({
      estimated1rmLb: 305,
      method: "logged_1rm",
    });
    expect(estimateOneRm({ weightLb: 305, reps: 1 })).toEqual({
      estimated1rmLb: 305,
      method: "logged_1rm",
    });
  });

  it("single at low RPE gets a +3% bump (under-max)", () => {
    expect(estimateOneRm({ weightLb: 200, reps: 1, rpe: 7 })).toEqual({
      estimated1rmLb: 206,
      method: "epley_from_set",
    });
  });

  it("Sarah's push press case: 80 × 5 → ~90 lb e1RM", () => {
    // 80 × 36 / (37 − 5) = 90
    expect(estimateOneRm({ weightLb: 80, reps: 5 })).toEqual({
      estimated1rmLb: 90,
      method: "brzycki_from_set",
    });
  });
});

describe("pickBestEstimate", () => {
  it("picks the highest estimate across mixed-source sets", () => {
    const sets = [
      { weightLb: 80, reps: 5 },
      { weightLb: 100, reps: 3 },
      { weightLb: 115, reps: 1, rpe: 9 },
    ];
    const best = pickBestEstimate(sets);
    expect(best?.est.estimated1rmLb).toBe(115);
    expect(best?.est.method).toBe("logged_1rm");
  });

  it("prefers logged_1rm when magnitude is equal", () => {
    const sets = [
      // Epley would estimate 115 here from 100 × ~4 reps; meanwhile logged
      // 115 at RPE 9 is a true single.
      { weightLb: 115, reps: 1, rpe: 9 },
      { weightLb: 100, reps: 4 },
    ];
    const best = pickBestEstimate(sets);
    expect(best?.est.method).toBe("logged_1rm");
  });

  it("returns null when every set is rejected", () => {
    const sets = [
      { weightLb: 95, reps: 5, rpe: 4 }, // pacing
      { weightLb: 0, reps: 5 },          // bogus
    ];
    expect(pickBestEstimate(sets)).toBeNull();
  });
});
