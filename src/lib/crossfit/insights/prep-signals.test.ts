import { describe, it, expect } from "vitest";
import {
  pickNoteNudge,
  pickRecentBests,
  proposeStretchGoal,
  recommendationForTopic,
  shapeComplaintBanners,
  shapeMovementHistoryEntries,
  type MovementHistoryCandidate,
  type MovementSignalRow,
  type NoteNudgeCandidate,
} from "./prep-signals";
import type { NotesPerformanceMetric } from "@/types/crossfit";

// ============================================
// proposeStretchGoal
// ============================================

describe("proposeStretchGoal", () => {
  function s(
    metric: NotesPerformanceMetric,
    value: number,
    unit = "reps"
  ): { metric: NotesPerformanceMetric; value: number; unit: string } {
    return { metric, value, unit };
  }

  it("reps_in_window: bumps by ~15% and preserves the unit", () => {
    expect(proposeStretchGoal(s("reps_in_window", 30, "reps"))).toEqual({
      value: 35,
      unit: "reps",
    });
  });

  it("unbroken_reps: same +15% rule", () => {
    expect(proposeStretchGoal(s("unbroken_reps", 20, "reps"))).toEqual({
      value: 23,
      unit: "reps",
    });
  });

  it("reps_in_window: clamps the delta so 200 doesn't propose 230", () => {
    // 200 × 1.15 = 230 → uncapped that's the "230 DUs" anti-example.
    // The delta cap (25 reps) and absolute cap (200) keep the result
    // bounded; in this case the absolute cap pins it to 200 itself, so
    // the proposal is meaningless and the helper returns null.
    expect(proposeStretchGoal(s("reps_in_window", 200, "reps"))).toBeNull();
  });

  it("reps_in_window: delta cap kicks in below the absolute cap", () => {
    // 150 × 1.15 = 172.5 → ceil to 173 (delta 23). Under the +25 delta
    // cap, so no clamp. Under 200 absolute cap. Should pass through.
    expect(proposeStretchGoal(s("reps_in_window", 150, "reps"))).toEqual({
      value: 173,
      unit: "reps",
    });
  });

  it("pace: proposes a ~7% faster value when ≥ 30 sec", () => {
    // 115s × 0.93 = 106.95 → floor 106
    expect(proposeStretchGoal(s("pace", 115, "sec"))).toEqual({
      value: 106,
      unit: "sec",
    });
  });

  it("pace: skips when value is already < 30s (sprint range)", () => {
    expect(proposeStretchGoal(s("pace", 25, "sec"))).toBeNull();
  });

  it("set_split: same pace logic (lower is better, 30s floor)", () => {
    expect(proposeStretchGoal(s("set_split", 60, "sec"))).toEqual({
      value: 55,
      unit: "sec",
    });
    expect(proposeStretchGoal(s("set_split", 20, "sec"))).toBeNull();
  });

  it("load_for_reps: explicitly skipped (owned by the 1RM Predictor)", () => {
    expect(proposeStretchGoal(s("load_for_reps", 135, "lb"))).toBeNull();
  });

  it("returns null for non-positive reps", () => {
    expect(proposeStretchGoal(s("reps_in_window", 0, "reps"))).toBeNull();
  });
});

// ============================================
// pickRecentBests
// ============================================

describe("pickRecentBests", () => {
  function r(
    movement: string,
    metric: NotesPerformanceMetric,
    value: number,
    workoutDate = "2026-05-01"
  ): MovementSignalRow {
    return {
      scoreId: `${movement}-${value}`,
      movementName: movement,
      metric,
      value,
      unit: metric === "pace" ? "sec" : "reps",
      window: null,
      qualitative: null,
      phrase: `${value}`,
      workoutDate,
    };
  }

  it("picks the highest value per (movement, metric) for higher-is-better metrics", () => {
    const rows = [
      r("Double Unders", "reps_in_window", 20),
      r("Double Unders", "reps_in_window", 35),
      r("Double Unders", "reps_in_window", 28),
    ];
    const best = pickRecentBests(rows);
    expect(best).toHaveLength(1);
    expect(best[0].value).toBe(35);
  });

  it("picks the LOWEST value per (movement, metric) for pace", () => {
    const rows = [
      r("Row", "pace", 120),
      r("Row", "pace", 105),
      r("Row", "pace", 115),
    ];
    const best = pickRecentBests(rows);
    expect(best).toHaveLength(1);
    expect(best[0].value).toBe(105);
  });

  it("treats different metrics as separate entries on the same movement", () => {
    const rows = [
      r("Double Unders", "reps_in_window", 30),
      r("Double Unders", "unbroken_reps", 25),
    ];
    const best = pickRecentBests(rows);
    expect(best).toHaveLength(2);
  });

  it("matches case-insensitively across movement names", () => {
    const rows = [
      r("Double Unders", "reps_in_window", 30),
      r("double unders", "reps_in_window", 35),
    ];
    const best = pickRecentBests(rows);
    expect(best).toHaveLength(1);
    expect(best[0].value).toBe(35);
  });
});

// ============================================
// shapeComplaintBanners
// ============================================

describe("shapeComplaintBanners", () => {
  it("attaches a static recommendation when the topic is in the map", () => {
    const banners = shapeComplaintBanners([
      {
        movement: "T2B",
        topic: "grip",
        phrase: "grip gave out",
        workoutDate: "2026-05-01",
      },
    ]);
    expect(banners).toHaveLength(1);
    expect(banners[0].recommendation).not.toBeNull();
  });

  it("leaves recommendation null when the topic is unknown", () => {
    const banners = shapeComplaintBanners([
      {
        movement: "Squat Snatch",
        topic: "form drift",
        phrase: "form fell apart late",
        workoutDate: "2026-05-01",
      },
    ]);
    expect(banners[0].recommendation).toBeNull();
  });

  it("dedupes by (movement, topic), keeping the most recent phrase", () => {
    const banners = shapeComplaintBanners([
      {
        movement: "T2B",
        topic: "grip",
        phrase: "older",
        workoutDate: "2026-04-01",
      },
      {
        movement: "T2B",
        topic: "grip",
        phrase: "newer",
        workoutDate: "2026-05-01",
      },
    ]);
    expect(banners).toHaveLength(1);
    expect(banners[0].phrase).toBe("newer");
  });

  it("caps at the per-call max and prefers the most recent banners", () => {
    const banners = shapeComplaintBanners(
      [
        {
          movement: "Pull-ups",
          topic: "grip",
          phrase: "a",
          workoutDate: "2026-01-01",
        },
        {
          movement: "DB Snatch",
          topic: "low back",
          phrase: "b",
          workoutDate: "2026-03-01",
        },
        {
          movement: "Push Press",
          topic: "shoulder",
          phrase: "c",
          workoutDate: "2026-05-01",
        },
      ],
      2
    );
    expect(banners).toHaveLength(2);
    expect(banners[0].movement).toBe("Push Press");
    expect(banners[1].movement).toBe("DB Snatch");
  });
});

// ============================================
// recommendationForTopic
// ============================================

describe("recommendationForTopic", () => {
  it("returns null for unknown topics", () => {
    expect(recommendationForTopic("rhabdo")).toBeNull();
  });

  it("normalizes whitespace + case before lookup", () => {
    expect(recommendationForTopic("  Grip  ")).not.toBeNull();
  });
});

// ============================================
// pickNoteNudge — score-entry note prompt (PR 3 §3.1)
// ============================================

describe("pickNoteNudge", () => {
  function c(
    movement: string,
    scaleCount: number,
    lastScaledAt = "2026-05-01"
  ): NoteNudgeCandidate {
    return { movement, scaleCount, lastScaledAt };
  }

  it("returns null when no candidates meet the 3-scale floor", () => {
    expect(pickNoteNudge([])).toBeNull();
    expect(pickNoteNudge([c("Toes to Bar", 2, "2026-05-15")])).toBeNull();
  });

  it("picks the eligible movement (≥ 3 scales)", () => {
    const out = pickNoteNudge([c("Toes to Bar", 3, "2026-05-15")]);
    expect(out).not.toBeNull();
    expect(out!.movement).toBe("Toes to Bar");
    expect(out!.scaleCount).toBe(3);
  });

  it("prefers the most-recent eligible movement when multiple qualify", () => {
    const out = pickNoteNudge([
      c("Pull-ups", 5, "2026-04-01"),
      c("Toes to Bar", 3, "2026-05-15"),
      c("Double Unders", 4, "2026-05-01"),
    ]);
    expect(out!.movement).toBe("Toes to Bar");
  });

  it("on equal last-scaled dates, picks the higher scale count", () => {
    const out = pickNoteNudge([
      c("Pull-ups", 3, "2026-05-15"),
      c("Toes to Bar", 6, "2026-05-15"),
    ]);
    expect(out!.movement).toBe("Toes to Bar");
    expect(out!.scaleCount).toBe(6);
  });

  it("filters out sub-floor candidates even when they're more recent", () => {
    // T2B scaled twice this week (sub-floor); DU scaled 4× last month.
    const out = pickNoteNudge([
      c("Toes to Bar", 2, "2026-05-30"),
      c("Double Unders", 4, "2026-04-15"),
    ]);
    expect(out!.movement).toBe("Double Unders");
  });
});

// ============================================
// shapeMovementHistoryEntries — notes_insights_v2_spec.md §4.2
// ============================================

describe("shapeMovementHistoryEntries", () => {
  function candidate(
    movementName: string,
    todayPrescribedLb: number | null,
    priorPrescribedLb: number | null,
    priorActualLb: number,
    workoutDate: string
  ): MovementHistoryCandidate {
    return {
      movementId: movementName.toLowerCase().replace(/\s+/g, "-"),
      movementName,
      todayPrescribedLb,
      priorContext: {
        workoutDate,
        priorPrescribedLb,
        priorActualLb,
        rpe: null,
        workoutTemplateTitle: `${movementName} template`,
      },
    };
  }

  it("returns an empty list when there are no candidates", () => {
    expect(shapeMovementHistoryEntries([])).toEqual([]);
  });

  it("caps the list at 3 entries", () => {
    const cs = [
      candidate("A", 100, 100, 100, "2026-05-01"),
      candidate("B", 100, 100, 100, "2026-05-02"),
      candidate("C", 100, 100, 100, "2026-05-03"),
      candidate("D", 100, 100, 100, "2026-05-04"),
    ];
    expect(shapeMovementHistoryEntries(cs)).toHaveLength(3);
  });

  it("orders by 'prescription differs' DESC, then workoutDate DESC", () => {
    // Two candidates whose prior prescribed weight DIFFERS from today's,
    // and one that matches. The two-differs entries should come first
    // (most recent first), then the same-prescription entry.
    const out = shapeMovementHistoryEntries([
      candidate("Same Today", 100, 100, 80, "2026-05-30"),
      candidate("Differs Old", 100, 80, 75, "2026-04-01"),
      candidate("Differs New", 100, 80, 75, "2026-05-15"),
    ]);
    expect(out.map((e) => e.movementName)).toEqual([
      "Differs New",
      "Differs Old",
      "Same Today",
    ]);
  });

  it("treats missing prior prescribed as 'does not differ' for ordering", () => {
    // No way to know if it differs when one side is null — fall through
    // to the more-decision-relevant differing case.
    const out = shapeMovementHistoryEntries([
      candidate("Null Prior", 100, null, 70, "2026-05-30"),
      candidate("Differs", 100, 75, 75, "2026-04-01"),
    ]);
    expect(out[0].movementName).toBe("Differs");
  });
});
