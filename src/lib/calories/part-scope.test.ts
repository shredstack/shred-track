// Regression tests for part-scoping. The bug these guard against: every
// part's score row stored the whole-workout total, so a 2-part workout
// reported identical calories for both parts.

import { describe, expect, it } from "vitest";
import { scopeToScoredPart } from "./part-scope";
import type { CalorieEstimate } from "./types";

// A 2-part workout: a heavy part-a and a small part-b. Top-level fields are
// the sums, mirroring what `estimateCalories` returns.
function twoPartEstimate(): CalorieEstimate {
  return {
    active: 80,
    gross: 110,
    activeWithEpoc: 88,
    grossWithEpoc: 121,
    low: 68,
    high: 92,
    confidence: "medium",
    method: "per_part",
    parts: [
      { partId: "part-a", kcalTotal: 90, kcalActive: 65, confidence: "high" },
      { partId: "part-b", kcalTotal: 20, kcalActive: 15, confidence: "medium" },
    ],
  };
}

describe("scopeToScoredPart", () => {
  it("returns the matched part's slice, not the workout total", () => {
    const a = scopeToScoredPart(twoPartEstimate(), "part-a", 1.0, false);
    const b = scopeToScoredPart(twoPartEstimate(), "part-b", 1.0, false);
    expect(a.active).toBe(65);
    expect(b.active).toBe(15);
    // The bug was both parts reporting the same number.
    expect(a.active).not.toBe(b.active);
  });

  it("the part slices sum back to the workout total", () => {
    const est = twoPartEstimate();
    const a = scopeToScoredPart(est, "part-a", 1.0, false);
    const b = scopeToScoredPart(est, "part-b", 1.0, false);
    expect(a.active + b.active).toBe(est.active);
    expect(a.gross + b.gross).toBe(est.gross);
  });

  it("applies the EPOC multiplier to the part slice", () => {
    const a = scopeToScoredPart(twoPartEstimate(), "part-a", 1.1, false);
    expect(a.activeWithEpoc).toBe(Math.round(65 * 1.1));
    expect(a.grossWithEpoc).toBe(Math.round(90 * 1.1));
  });

  it("carries the part's own confidence", () => {
    expect(scopeToScoredPart(twoPartEstimate(), "part-a", 1.0, false).confidence).toBe(
      "high"
    );
    expect(scopeToScoredPart(twoPartEstimate(), "part-b", 1.0, false).confidence).toBe(
      "medium"
    );
  });

  it("demotes the part confidence on a default-bodyweight estimate", () => {
    const defaulted = scopeToScoredPart(twoPartEstimate(), "part-a", 1.0, true);
    expect(defaulted.confidence).toBe("medium"); // high → medium
  });

  it("falls back to the workout total when the part can't be matched", () => {
    expect(scopeToScoredPart(twoPartEstimate(), "missing", 1.0, false).active).toBe(80);
    expect(scopeToScoredPart(twoPartEstimate(), null, 1.0, false).active).toBe(80);
    expect(scopeToScoredPart(twoPartEstimate(), undefined, 1.0, false).active).toBe(80);
  });

  it("treats a single-part workout's only part as the whole workout", () => {
    const single: CalorieEstimate = {
      ...twoPartEstimate(),
      parts: [{ partId: "solo", kcalTotal: 110, kcalActive: 80, confidence: "high" }],
    };
    const scoped = scopeToScoredPart(single, "solo", 1.0, false);
    expect(scoped.active).toBe(80);
    expect(scoped.gross).toBe(110);
  });
});
