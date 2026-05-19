import { describe, expect, it } from "vitest";
import {
  generateProgression,
  type ProgressionInput,
} from "@/lib/programming/progression-generator";

function base(): Omit<
  ProgressionInput,
  "startsOn" | "endsOn" | "movement" | "scoreType"
> {
  return {
    startReps: 30,
    dailyIncrement: 5,
    restCadence: "none",
  };
}

describe("generateProgression", () => {
  it("emits one row per date in [startsOn, endsOn]", () => {
    const out = generateProgression({
      ...base(),
      startsOn: "2026-06-01",
      endsOn: "2026-06-07",
      movement: "sit-ups",
      scoreType: "reps",
    });
    expect(out).toHaveLength(7);
    expect(out[0].date).toBe("2026-06-01");
    expect(out[6].date).toBe("2026-06-07");
  });

  it("applies a per-working-day increment with rest every 7th day", () => {
    const out = generateProgression({
      ...base(),
      startsOn: "2026-06-01",
      endsOn: "2026-06-08",
      movement: "sit-ups",
      restCadence: "everyN",
      restEveryN: 7,
      scoreType: "reps",
    });
    expect(out).toHaveLength(8);
    expect(out[0].reps).toBe(30);
    expect(out[1].reps).toBe(35);
    expect(out[5].reps).toBe(55);
    // 7th calendar day = rest, not 7*5+30
    expect(out[6].isRestDay).toBe(true);
    expect(out[6].body).toMatch(/Rest Day/);
    expect(out[6].isScored).toBe(false);
    // 8th calendar day continues the progression from working-day 7
    expect(out[7].reps).toBe(60);
  });

  it("clamps reps at capReps but continues emitting rows", () => {
    const out = generateProgression({
      ...base(),
      startsOn: "2026-06-01",
      endsOn: "2026-06-05",
      movement: "burpees",
      startReps: 100,
      dailyIncrement: 50,
      capReps: 200,
      scoreType: "reps",
    });
    expect(out[0].reps).toBe(100);
    expect(out[1].reps).toBe(150);
    expect(out[2].reps).toBe(200);
    expect(out[3].reps).toBe(200); // clamped
    expect(out[4].reps).toBe(200); // still clamped
  });

  it("handles zero increment", () => {
    const out = generateProgression({
      ...base(),
      startsOn: "2026-06-01",
      endsOn: "2026-06-03",
      movement: "push-ups",
      startReps: 25,
      dailyIncrement: 0,
      scoreType: "reps",
    });
    expect(out.map((o) => o.reps)).toEqual([25, 25, 25]);
  });

  it("rests on specific days of the week", () => {
    const out = generateProgression({
      ...base(),
      // 2026-06-01 is a Monday → Sunday is 2026-06-07
      startsOn: "2026-06-01",
      endsOn: "2026-06-08",
      movement: "sit-ups",
      restCadence: "daysOfWeek",
      restDaysOfWeek: [0],
      scoreType: "reps",
    });
    // 2026-06-07 is Sunday → rest day
    const restRow = out.find((r) => r.date === "2026-06-07");
    expect(restRow?.isRestDay).toBe(true);
    expect(restRow?.body).toMatch(/Rest Day/);
  });

  it("emits a single day when startsOn==endsOn", () => {
    const out = generateProgression({
      ...base(),
      startsOn: "2026-06-01",
      endsOn: "2026-06-01",
      movement: "sit-ups",
      scoreType: "reps",
    });
    expect(out).toHaveLength(1);
    expect(out[0].reps).toBe(30);
  });

  it("prefixes the body with the format string when provided", () => {
    const out = generateProgression({
      ...base(),
      startsOn: "2026-06-01",
      endsOn: "2026-06-01",
      movement: "sit-ups",
      format: "For time",
      scoreType: "reps",
    });
    expect(out[0].body).toBe("For time: 30 sit-ups");
  });

  it("uses a custom rest label when provided", () => {
    const out = generateProgression({
      ...base(),
      startsOn: "2026-06-01",
      endsOn: "2026-06-07",
      movement: "sit-ups",
      restCadence: "everyN",
      restEveryN: 7,
      restDayLabel: "Active recovery",
      scoreType: "reps",
    });
    const rest = out.find((r) => r.isRestDay);
    expect(rest?.body).toBe("Active recovery");
  });

  it("rejects endsOn before startsOn", () => {
    expect(() =>
      generateProgression({
        ...base(),
        startsOn: "2026-06-05",
        endsOn: "2026-06-01",
        movement: "x",
        scoreType: "reps",
      })
    ).toThrow();
  });

  it("rejects invalid restEveryN", () => {
    expect(() =>
      generateProgression({
        ...base(),
        startsOn: "2026-06-01",
        endsOn: "2026-06-10",
        movement: "x",
        restCadence: "everyN",
        restEveryN: 1,
        scoreType: "reps",
      })
    ).toThrow();
  });
});
