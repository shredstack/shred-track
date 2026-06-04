import { describe, it, expect } from "vitest";
import {
  aggregateWeeklyDigestFromRows,
  type DigestComplaintRow,
  type DigestScalingRow,
  type DigestSignalRow,
} from "./digest";
import type { NotesPerformanceMetric } from "@/types/crossfit";

// ============================================
// Date helpers — every test pins `now` so the trailing-7-day window is
// deterministic and the dormant lookback aligns with synthetic dates.
// ============================================

const DAY_MS = 24 * 60 * 60 * 1000;
const FIXED_NOW = new Date("2026-06-04T12:00:00Z");

function isoDaysAgo(n: number): string {
  return new Date(FIXED_NOW.getTime() - n * DAY_MS).toISOString().slice(0, 10);
}

function complaint(
  scoreId: string,
  workoutDate: string,
  topics: string[],
  phraseByTopic: Record<string, string> = {}
): DigestComplaintRow {
  return { scoreId, workoutDate, topics, phraseByTopic };
}

function scaled(
  scoreId: string,
  workoutDate: string,
  movements: string[]
): DigestScalingRow {
  return { scoreId, workoutDate, movements };
}

function signal(
  scoreId: string,
  workoutDate: string,
  movement: string,
  metric: NotesPerformanceMetric,
  value: number,
  opts: Partial<DigestSignalRow> = {}
): DigestSignalRow {
  return {
    scoreId,
    workoutDate,
    movement,
    metric,
    value,
    unit: opts.unit ?? (metric === "pace" ? "sec" : "reps"),
    window: opts.window ?? null,
    qualitative: opts.qualitative ?? null,
    phrase: opts.phrase ?? `${value}`,
  };
}

// ============================================
// "skip if < 2 bullets" gate
// ============================================

describe("aggregateWeeklyDigestFromRows — bullet floor", () => {
  it("returns null when no rows produce any bullets", () => {
    const out = aggregateWeeklyDigestFromRows({
      now: FIXED_NOW,
      complaintRows: [],
      scalingRows: [],
      signalRows: [],
    });
    expect(out).toBeNull();
  });

  it("returns null when only one bullet would surface", () => {
    // One newly-scaled bullet, nothing else. Below the 2-bullet floor.
    const out = aggregateWeeklyDigestFromRows({
      now: FIXED_NOW,
      complaintRows: [],
      scalingRows: [
        scaled("s1", isoDaysAgo(2), ["Double Unders"]),
      ],
      signalRows: [],
    });
    expect(out).toBeNull();
  });

  it("returns the digest when at least 2 bullets qualify", () => {
    // Newly scaled + best-of-week.
    const out = aggregateWeeklyDigestFromRows({
      now: FIXED_NOW,
      complaintRows: [],
      scalingRows: [scaled("s1", isoDaysAgo(3), ["Double Unders"])],
      signalRows: [
        signal("s1", isoDaysAgo(3), "Double Unders", "reps_in_window", 30, {
          window: "1.5 min",
        }),
      ],
    });
    expect(out).not.toBeNull();
    expect(out!.bullets).toHaveLength(2);
  });
});

// ============================================
// New complaint bullet
// ============================================

describe("new_complaint bullet", () => {
  it("surfaces when ≥ 2 mentions this week and 0 in prior 28 days", () => {
    const rows: DigestComplaintRow[] = [
      complaint("a", isoDaysAgo(1), ["tight hip"], {
        "tight hip": "tight hip after warmup",
      }),
      complaint("b", isoDaysAgo(4), ["tight hip"]),
      // Filler — different topic — ensures the bullet only fires for hip.
      complaint("c", isoDaysAgo(2), ["form drift"]),
    ];
    const out = aggregateWeeklyDigestFromRows({
      now: FIXED_NOW,
      complaintRows: rows,
      // Pad with one extra qualifying bullet so we clear the 2-bullet
      // floor — the test cares about the new_complaint bullet shape.
      scalingRows: [scaled("c", isoDaysAgo(2), ["Pull-ups"])],
      signalRows: [
        signal("c", isoDaysAgo(2), "Pull-ups", "unbroken_reps", 8),
      ],
    });
    const nc = out!.bullets.find((b) => b.kind === "new_complaint");
    expect(nc).toBeDefined();
    expect(nc!.kind === "new_complaint" && nc!.topic).toBe("tight hip");
    expect(nc!.kind === "new_complaint" && nc!.mentions).toBe(2);
  });

  it("does NOT surface when the topic appeared in the prior 28 days", () => {
    const rows: DigestComplaintRow[] = [
      complaint("a", isoDaysAgo(1), ["tight hip"]),
      complaint("b", isoDaysAgo(4), ["tight hip"]),
      // Disqualifies: same topic 10 days ago — not "new this week".
      complaint("prior", isoDaysAgo(10), ["tight hip"]),
    ];
    const out = aggregateWeeklyDigestFromRows({
      now: FIXED_NOW,
      complaintRows: rows,
      scalingRows: [scaled("c", isoDaysAgo(2), ["Pull-ups"])],
      signalRows: [
        signal("c", isoDaysAgo(2), "Pull-ups", "unbroken_reps", 8),
      ],
    });
    const nc = out?.bullets.find((b) => b.kind === "new_complaint");
    expect(nc).toBeUndefined();
  });

  it("requires ≥ 2 distinct mentions in the week", () => {
    const rows: DigestComplaintRow[] = [
      complaint("a", isoDaysAgo(1), ["tight hip"]),
    ];
    const out = aggregateWeeklyDigestFromRows({
      now: FIXED_NOW,
      complaintRows: rows,
      scalingRows: [scaled("c", isoDaysAgo(2), ["Pull-ups"])],
      signalRows: [
        signal("c", isoDaysAgo(2), "Pull-ups", "unbroken_reps", 8),
      ],
    });
    const nc = out?.bullets.find((b) => b.kind === "new_complaint");
    expect(nc).toBeUndefined();
  });
});

// ============================================
// Newly scaled bullet
// ============================================

describe("newly_scaled bullet", () => {
  it("surfaces a movement scaled this week but not in the prior 7 days", () => {
    const out = aggregateWeeklyDigestFromRows({
      now: FIXED_NOW,
      complaintRows: [],
      scalingRows: [
        scaled("s1", isoDaysAgo(2), ["Double Unders"]),
        // Filler — different movement, prior week — irrelevant.
        scaled("s2", isoDaysAgo(10), ["Pull-ups"]),
      ],
      signalRows: [
        signal("s1", isoDaysAgo(2), "Double Unders", "reps_in_window", 30),
      ],
    });
    const ns = out!.bullets.find((b) => b.kind === "newly_scaled");
    expect(ns).toBeDefined();
    expect(ns!.kind === "newly_scaled" && ns!.movement).toBe("Double Unders");
  });

  it("does NOT surface a movement scaled in the prior 7 days", () => {
    const out = aggregateWeeklyDigestFromRows({
      now: FIXED_NOW,
      complaintRows: [],
      scalingRows: [
        scaled("s1", isoDaysAgo(2), ["Double Unders"]),
        // Disqualifies: scaled 8 days ago — within the 7-day prior window.
        scaled("s2", isoDaysAgo(8), ["Double Unders"]),
      ],
      signalRows: [
        signal("s1", isoDaysAgo(2), "Double Unders", "reps_in_window", 30),
        signal("s2", isoDaysAgo(8), "Double Unders", "reps_in_window", 25),
      ],
    });
    const ns = out?.bullets.find((b) => b.kind === "newly_scaled");
    expect(ns).toBeUndefined();
  });
});

// ============================================
// Best of the week bullet
// ============================================

describe("best_of_week bullet", () => {
  it("prefers a 'qualitative: better' signal over a higher numeric value", () => {
    // Higher value but no self-report vs. lower value with "better" tag.
    const out = aggregateWeeklyDigestFromRows({
      now: FIXED_NOW,
      complaintRows: [],
      scalingRows: [scaled("s1", isoDaysAgo(2), ["Pull-ups"])],
      signalRows: [
        signal("a", isoDaysAgo(3), "DU", "reps_in_window", 50),
        signal("b", isoDaysAgo(1), "DU", "reps_in_window", 30, {
          qualitative: "better",
          phrase: "smoother than before",
        }),
      ],
    });
    const best = out!.bullets.find((b) => b.kind === "best_of_week");
    expect(best).toBeDefined();
    expect(best!.kind === "best_of_week" && best!.value).toBe(30);
    expect(best!.kind === "best_of_week" && best!.phrase).toBe(
      "smoother than before"
    );
  });

  it("picks the highest reps_in_window when no 'better' tag exists", () => {
    const out = aggregateWeeklyDigestFromRows({
      now: FIXED_NOW,
      complaintRows: [],
      scalingRows: [scaled("s1", isoDaysAgo(2), ["Pull-ups"])],
      signalRows: [
        signal("a", isoDaysAgo(3), "DU", "reps_in_window", 25),
        signal("b", isoDaysAgo(1), "DU", "reps_in_window", 35),
      ],
    });
    const best = out!.bullets.find((b) => b.kind === "best_of_week");
    expect(best!.kind === "best_of_week" && best!.value).toBe(35);
  });

  it("picks the fastest pace when only pace signals exist", () => {
    const out = aggregateWeeklyDigestFromRows({
      now: FIXED_NOW,
      complaintRows: [],
      scalingRows: [scaled("s1", isoDaysAgo(2), ["Pull-ups"])],
      signalRows: [
        signal("a", isoDaysAgo(3), "Row", "pace", 120, { unit: "sec" }),
        signal("b", isoDaysAgo(1), "Row", "pace", 110, { unit: "sec" }),
      ],
    });
    const best = out!.bullets.find((b) => b.kind === "best_of_week");
    expect(best!.kind === "best_of_week" && best!.value).toBe(110);
  });

  it("does NOT surface when no signals fall inside the week", () => {
    const out = aggregateWeeklyDigestFromRows({
      now: FIXED_NOW,
      complaintRows: [
        complaint("a", isoDaysAgo(1), ["hip"]),
        complaint("b", isoDaysAgo(4), ["hip"]),
      ],
      scalingRows: [scaled("s1", isoDaysAgo(2), ["Pull-ups"])],
      // Signal is 10 days old — outside the week window.
      signalRows: [signal("c", isoDaysAgo(10), "DU", "reps_in_window", 50)],
    });
    const best = out?.bullets.find((b) => b.kind === "best_of_week");
    expect(best).toBeUndefined();
  });
});

// ============================================
// Dormant bullet
// ============================================

describe("dormant bullet", () => {
  it("surfaces a topic mentioned in history but quiet for 4+ weeks", () => {
    // Three grip mentions in the 28-84 day history window, none recent.
    const complaintRows: DigestComplaintRow[] = [
      complaint("h1", isoDaysAgo(70), ["grip"]),
      complaint("h2", isoDaysAgo(50), ["grip"]),
      complaint("h3", isoDaysAgo(40), ["grip"]),
      // This-week mentions of a different topic so we hit the 2-bullet
      // floor; "hip" needs to also produce something we can pair with.
      complaint("a", isoDaysAgo(1), ["tight hip"]),
      complaint("b", isoDaysAgo(4), ["tight hip"]),
    ];
    const out = aggregateWeeklyDigestFromRows({
      now: FIXED_NOW,
      complaintRows,
      scalingRows: [],
      signalRows: [],
    });
    const dormant = out!.bullets.find((b) => b.kind === "dormant");
    expect(dormant).toBeDefined();
    expect(dormant!.kind === "dormant" && dormant!.topic).toBe("grip");
    expect(
      dormant!.kind === "dormant" && dormant!.weeksSilent
    ).toBeGreaterThanOrEqual(5);
  });

  it("does NOT surface a still-mentioned topic", () => {
    const complaintRows: DigestComplaintRow[] = [
      complaint("h1", isoDaysAgo(70), ["grip"]),
      complaint("h2", isoDaysAgo(50), ["grip"]),
      complaint("h3", isoDaysAgo(40), ["grip"]),
      // Disqualifies — grip mentioned in the last 28 days.
      complaint("r1", isoDaysAgo(5), ["grip"]),
      complaint("r2", isoDaysAgo(6), ["grip"]),
    ];
    const out = aggregateWeeklyDigestFromRows({
      now: FIXED_NOW,
      complaintRows,
      scalingRows: [scaled("c", isoDaysAgo(2), ["Pull-ups"])],
      signalRows: [
        signal("c", isoDaysAgo(2), "Pull-ups", "unbroken_reps", 8),
      ],
    });
    const dormant = out?.bullets.find((b) => b.kind === "dormant");
    expect(dormant).toBeUndefined();
  });
});

// ============================================
// All four bullets stack
// ============================================

describe("aggregateWeeklyDigestFromRows — combined", () => {
  it("returns up to four bullets when every category qualifies", () => {
    const complaintRows: DigestComplaintRow[] = [
      // New this week
      complaint("a", isoDaysAgo(1), ["tight hip"]),
      complaint("b", isoDaysAgo(4), ["tight hip"]),
      complaint("c", isoDaysAgo(2), ["tight hip"]),
      // Dormant (grip in history, none recent)
      complaint("h1", isoDaysAgo(70), ["grip"]),
      complaint("h2", isoDaysAgo(55), ["grip"]),
      complaint("h3", isoDaysAgo(40), ["grip"]),
    ];
    const scalingRows: DigestScalingRow[] = [
      // Newly scaled this week (DU not scaled in prior 7d)
      scaled("a", isoDaysAgo(2), ["Double Unders"]),
    ];
    const signalRows: DigestSignalRow[] = [
      // Best of the week
      signal("a", isoDaysAgo(2), "Double Unders", "reps_in_window", 30, {
        qualitative: "better",
        window: "1.5 min",
        phrase: "smoother than before",
      }),
    ];
    const out = aggregateWeeklyDigestFromRows({
      now: FIXED_NOW,
      complaintRows,
      scalingRows,
      signalRows,
    });
    expect(out).not.toBeNull();
    const kinds = out!.bullets.map((b) => b.kind).sort();
    expect(kinds).toEqual(
      ["best_of_week", "dormant", "new_complaint", "newly_scaled"].sort()
    );
  });
});
