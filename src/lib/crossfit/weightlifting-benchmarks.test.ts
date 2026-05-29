import { describe, expect, it } from "vitest";
import {
  classifyRepMaxSets,
  inferRepMaxTarget,
  pickBestPerRepTarget,
  type RepTargetScore,
} from "./weightlifting-benchmarks";
import type { SetEntry } from "@/types/crossfit";

// inferRepMaxTarget is the rep-scheme classification surface — what
// determines whether a logged workout shows up under a rep-max tab and
// whether the auto-link inference fires. Errors here either silently drop
// valid attempts or attribute them to the wrong target, both of which
// confuse the athlete's PR view. Test it broadly.

describe("inferRepMaxTarget", () => {
  describe("fixed numbers", () => {
    it.each([
      ["1", 1],
      ["2", 2],
      ["3", 3],
      ["5", 5],
    ] as const)("classifies %s → %s", (input, expected) => {
      expect(inferRepMaxTarget(input)).toBe(expected);
    });

    it.each(["4", "6", "10", "21"])(
      "rejects fixed %s (not a rep-max target)",
      (input) => {
        expect(inferRepMaxTarget(input)).toBeNull();
      }
    );
  });

  describe("sets notation", () => {
    it.each([
      ["5x5", 5],
      ["5×5", 5],
      ["5 x 5", 5],
      ["3x3", 3],
      ["3x1", 1],
      ["1x1", 1],
      ["10x2", 2],
    ] as const)("classifies %s → %s", (input, expected) => {
      expect(inferRepMaxTarget(input)).toBe(expected);
    });

    it("rejects sets at non-rep-max rep count", () => {
      expect(inferRepMaxTarget("5x4")).toBeNull();
      expect(inferRepMaxTarget("3x10")).toBeNull();
    });
  });

  describe("uniform sequences", () => {
    it.each([
      ["5-5-5-5-5", 5],
      ["3-3-3", 3],
      ["1-1-1-1-1", 1],
      ["2-2", 2],
    ] as const)("classifies %s → %s", (input, expected) => {
      expect(inferRepMaxTarget(input)).toBe(expected);
    });

    it("rejects mixed-rep sequence", () => {
      expect(inferRepMaxTarget("5-5-3-3-1")).toBeNull();
      expect(inferRepMaxTarget("21-15-9")).toBeNull();
    });

    it("rejects uniform sequence at non-rep-max count", () => {
      expect(inferRepMaxTarget("4-4-4")).toBeNull();
      expect(inferRepMaxTarget("10-10-10")).toBeNull();
    });
  });

  describe("ladders and other shapes", () => {
    it("rejects open ladder (mixed reps across rounds)", () => {
      expect(inferRepMaxTarget("3-6-9-12...")).toBeNull();
    });

    it("rejects ladder with explicit increment", () => {
      expect(inferRepMaxTarget("3-6-9-12+3")).toBeNull();
    });
  });

  describe("unparseable inputs", () => {
    it.each(["", null, undefined, "1RM", "AHAP", "for time", "  "])(
      "rejects %s",
      (input) => {
        expect(inferRepMaxTarget(input as string | null | undefined)).toBeNull();
      }
    );
  });
});

describe("pickBestPerRepTarget", () => {
  const score = (overrides: Partial<RepTargetScore>): RepTargetScore => ({
    scoreId: "score-1",
    workoutDate: "2026-04-01",
    weightLbs: 100,
    repTarget: 1,
    ...overrides,
  });

  it("returns the heaviest weight per target", () => {
    const result = pickBestPerRepTarget([
      score({ scoreId: "s1", weightLbs: 300, repTarget: 1 }),
      score({ scoreId: "s2", weightLbs: 315, repTarget: 1 }),
      score({ scoreId: "s3", weightLbs: 305, repTarget: 1 }),
      score({ scoreId: "s4", weightLbs: 275, repTarget: 3 }),
    ]);
    expect(result[1]?.scoreId).toBe("s2");
    expect(result[3]?.scoreId).toBe("s4");
    expect(result[2]).toBeNull();
    expect(result[5]).toBeNull();
  });

  it("ties break to the older workout date", () => {
    const result = pickBestPerRepTarget([
      score({ scoreId: "newer", weightLbs: 315, workoutDate: "2026-04-15", repTarget: 1 }),
      score({ scoreId: "older", weightLbs: 315, workoutDate: "2025-12-01", repTarget: 1 }),
    ]);
    expect(result[1]?.scoreId).toBe("older");
  });

  it("ignores rows with null weight", () => {
    const result = pickBestPerRepTarget([
      score({ scoreId: "skip", weightLbs: null, repTarget: 1 }),
      score({ scoreId: "keep", weightLbs: 200, repTarget: 1 }),
    ]);
    expect(result[1]?.scoreId).toBe("keep");
  });

  it("returns all-null when the input is empty", () => {
    const result = pickBestPerRepTarget([]);
    expect(result).toEqual({ 1: null, 2: null, 3: null, 5: null });
  });
});

describe("classifyRepMaxSets", () => {
  const baseInput = {
    scoreWeightLbs: null,
    actualWeight: null,
    movementPrescribedReps: null,
    partRepScheme: null,
  };

  it("buckets a ladder by each set's own reps", () => {
    const setEntries: SetEntry[] = [
      { weight: 190, reps: 3 },
      { weight: 200, reps: 2 },
      { weight: 230, reps: 1 },
    ];
    const result = classifyRepMaxSets({ ...baseInput, setEntries });
    expect(result.get(1)).toBe(230);
    expect(result.get(2)).toBe(200);
    expect(result.get(3)).toBe(190);
    expect(result.get(5)).toBeUndefined();
  });

  it("keeps the heaviest set when a target appears multiple times", () => {
    const setEntries: SetEntry[] = [
      { weight: 135, reps: 3 },
      { weight: 190, reps: 3 },
      { weight: 175, reps: 3 },
    ];
    const result = classifyRepMaxSets({ ...baseInput, setEntries });
    expect(result.get(3)).toBe(190);
  });

  it("skips sets with reps outside {1,2,3,5}", () => {
    const setEntries: SetEntry[] = [
      { weight: 225, reps: 4 },
      { weight: 185, reps: 10 },
      { weight: 230, reps: 1 },
    ];
    const result = classifyRepMaxSets({ ...baseInput, setEntries });
    expect(result.get(1)).toBe(230);
    expect(result.size).toBe(1);
  });

  it("falls back to the prescription when a set has no explicit reps", () => {
    const setEntries: SetEntry[] = [{ weight: 175 }];
    const result = classifyRepMaxSets({
      ...baseInput,
      setEntries,
      movementPrescribedReps: "3",
    });
    expect(result.get(3)).toBe(175);
  });

  it("uses the part-level repScheme when movement-level prescription is null", () => {
    const setEntries: SetEntry[] = [{ weight: 200 }];
    const result = classifyRepMaxSets({
      ...baseInput,
      setEntries,
      partRepScheme: "5×5",
    });
    expect(result.get(5)).toBe(200);
  });

  it("drops entries with no reps when prescription is a non-uniform ladder", () => {
    const setEntries: SetEntry[] = [
      { weight: 200 },
      { weight: 230, reps: 1 },
    ];
    const result = classifyRepMaxSets({
      ...baseInput,
      setEntries,
      partRepScheme: "3-3-2-2-1-1-1",
    });
    expect(result.get(1)).toBe(230);
    expect(result.size).toBe(1);
  });

  it("legacy fallback: classifies scores.weightLbs by a uniform prescription when no set entries", () => {
    const result = classifyRepMaxSets({
      ...baseInput,
      setEntries: [],
      scoreWeightLbs: 175,
      movementPrescribedReps: "3",
    });
    expect(result.get(3)).toBe(175);
  });

  it("legacy fallback: prefers actualWeight when scoreWeightLbs is null", () => {
    const result = classifyRepMaxSets({
      ...baseInput,
      setEntries: [],
      actualWeight: 150,
      movementPrescribedReps: "5",
    });
    expect(result.get(5)).toBe(150);
  });

  it("legacy fallback: emits nothing when prescription is non-uniform", () => {
    const result = classifyRepMaxSets({
      ...baseInput,
      setEntries: [],
      scoreWeightLbs: 200,
      partRepScheme: "3-3-2-2-1-1-1",
    });
    expect(result.size).toBe(0);
  });

  it("legacy fallback: emits nothing when both weights are null", () => {
    const result = classifyRepMaxSets({
      ...baseInput,
      setEntries: [],
      movementPrescribedReps: "3",
    });
    expect(result.size).toBe(0);
  });

  it("skips entries with non-positive weight", () => {
    const setEntries: SetEntry[] = [
      { weight: 0, reps: 1 },
      { weight: -10, reps: 2 },
      { weight: 230, reps: 1 },
    ];
    const result = classifyRepMaxSets({ ...baseInput, setEntries });
    expect(result.get(1)).toBe(230);
    expect(result.size).toBe(1);
  });
});
