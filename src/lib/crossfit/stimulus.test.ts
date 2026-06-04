import { describe, expect, it } from "vitest";
import {
  classifyStimulus,
  isHeavyRepScheme,
  isModerateStrengthRepScheme,
  resolveTimeDomainSeconds,
  type PartForClassification,
} from "./stimulus";

function part(overrides: Partial<PartForClassification>): PartForClassification {
  return {
    workoutType: "amrap",
    movementCategories: ["barbell"],
    ...overrides,
  };
}

describe("isHeavyRepScheme", () => {
  it("matches NxR with low reps", () => {
    expect(isHeavyRepScheme("5x1")).toBe(true);
    expect(isHeavyRepScheme("3x3")).toBe(true);
    expect(isHeavyRepScheme("5 x 2")).toBe(true);
  });
  it("matches dashed low-rep ladders", () => {
    expect(isHeavyRepScheme("3-3-3-3-3")).toBe(true);
    expect(isHeavyRepScheme("1-1-1-1-1")).toBe(true);
  });
  it("rejects higher reps", () => {
    expect(isHeavyRepScheme("5x5")).toBe(false);
    expect(isHeavyRepScheme("21-15-9")).toBe(false);
  });
  it("handles empty / null", () => {
    expect(isHeavyRepScheme(null)).toBe(false);
    expect(isHeavyRepScheme("")).toBe(false);
  });
});

describe("isModerateStrengthRepScheme", () => {
  it("matches the 5-8 band", () => {
    expect(isModerateStrengthRepScheme("5x5")).toBe(true);
    expect(isModerateStrengthRepScheme("3x8")).toBe(true);
    expect(isModerateStrengthRepScheme("6-6-6")).toBe(true);
  });
  it("rejects out-of-band schemes", () => {
    expect(isModerateStrengthRepScheme("5x3")).toBe(false);
    expect(isModerateStrengthRepScheme("21-15-9")).toBe(false);
  });
});

describe("resolveTimeDomainSeconds", () => {
  it("returns amrap duration", () => {
    expect(
      resolveTimeDomainSeconds(
        part({ workoutType: "amrap", amrapDurationSeconds: 420 })
      )
    ).toBe(420);
  });
  it("sums interval rounds", () => {
    expect(
      resolveTimeDomainSeconds(
        part({
          workoutType: "intervals",
          intervalRounds: [
            { workSeconds: 240, restSeconds: 240 },
            { workSeconds: 180, restSeconds: 180 },
          ],
        })
      )
    ).toBe(840);
  });
  it("computes EMOM total", () => {
    expect(
      resolveTimeDomainSeconds(
        part({ workoutType: "emom", emomIntervalSeconds: 60, rounds: 10 })
      )
    ).toBe(600);
  });
  it("returns null when domain is unresolvable", () => {
    expect(
      resolveTimeDomainSeconds(part({ workoutType: "for_load" }))
    ).toBe(null);
  });
});

describe("classifyStimulus", () => {
  it("max_effort → strength_heavy", () => {
    expect(
      classifyStimulus(part({ workoutType: "max_effort" }))
    ).toBe("strength_heavy");
  });

  it("for_load 5x3 → strength_heavy", () => {
    expect(
      classifyStimulus(part({ workoutType: "for_load", repScheme: "5x3" }))
    ).toBe("strength_heavy");
  });

  it("for_load 5x5 → strength_moderate", () => {
    expect(
      classifyStimulus(part({ workoutType: "for_load", repScheme: "5x5" }))
    ).toBe("strength_moderate");
  });

  it("for_load 'for working sets, no scheme' → strength_moderate", () => {
    expect(
      classifyStimulus(part({ workoutType: "for_load", repScheme: null }))
    ).toBe("strength_moderate");
  });

  it("AMRAP 7 with barbell only → short_intense", () => {
    expect(
      classifyStimulus(
        part({
          workoutType: "amrap",
          amrapDurationSeconds: 420,
          movementCategories: ["barbell"],
        })
      )
    ).toBe("moderate_metcon"); // 7 min lands in the 5–15 band
  });

  it("Fran (for_time ~5 min cap, barbell) → short_intense at 5min, moderate above", () => {
    expect(
      classifyStimulus(
        part({
          workoutType: "for_time",
          timeCapSeconds: 5 * 60,
          repScheme: "21-15-9",
          movementCategories: ["barbell", "gymnastics"],
        })
      )
    ).toBe("short_intense");
  });

  it("Murph-like long for_time → long_metcon", () => {
    expect(
      classifyStimulus(
        part({
          workoutType: "for_time",
          timeCapSeconds: 60 * 60,
          movementCategories: ["gymnastics", "monostructural"],
        })
      )
    ).toBe("long_metcon");
  });

  it("Olympic flavor in a metcon → oly_metcon", () => {
    expect(
      classifyStimulus(
        part({
          workoutType: "amrap",
          amrapDurationSeconds: 12 * 60,
          movementCategories: ["olympic", "gymnastics"],
        })
      )
    ).toBe("oly_metcon");
  });

  it("Push press AMRAP 7 ladder (Sarah's actual example) → moderate_metcon", () => {
    // 7-min AMRAP, 1-2-3-4-5 ladder, push press (barbell, not olympic).
    // Per spec, ladder shape pushes total volume up — still moderate_metcon.
    expect(
      classifyStimulus(
        part({
          workoutType: "amrap",
          amrapDurationSeconds: 7 * 60,
          repScheme: "1-2-3-4-5",
          movementCategories: ["barbell"],
        })
      )
    ).toBe("moderate_metcon");
  });

  it("default for unknown types → moderate_metcon", () => {
    expect(
      classifyStimulus(
        part({
          workoutType: "custom" as string,
          movementCategories: ["barbell"],
        })
      )
    ).toBe("moderate_metcon");
  });
});
