import { describe, it, expect } from "vitest";
import {
  formatNotesForPrompt,
  parseExtraction,
  rollupRows,
} from "./notes-extraction";
import type {
  NotesComplaint,
  NotesMilestone,
  NotesScalingReason,
} from "@/types/crossfit";

// ============================================
// parseExtraction
// ============================================

describe("parseExtraction", () => {
  it("parses a clean JSON response", () => {
    const raw = JSON.stringify({
      complaints: [{ topic: "Shoulder", phrase: "shoulder felt off", confidence: 0.8 }],
      scalingRationale: [
        { movement: "C2B", reason: "Grip", phrase: "grip went" },
      ],
      milestones: [{ type: "first", phrase: "first time linking T2B" }],
    });
    const out = parseExtraction(raw);
    expect(out.complaints).toHaveLength(1);
    expect(out.complaints[0].topic).toBe("shoulder"); // lowercased
    expect(out.complaints[0].confidence).toBe(0.8);
    expect(out.scalingRationale[0].movement).toBe("C2B");
    expect(out.scalingRationale[0].reason).toBe("grip");
    expect(out.milestones[0].type).toBe("first");
  });

  it("strips markdown code fences", () => {
    const raw = "```json\n" + JSON.stringify({ complaints: [], scalingRationale: [], milestones: [] }) + "\n```";
    const out = parseExtraction(raw);
    expect(out.complaints).toEqual([]);
  });

  it("returns empty extraction for malformed JSON", () => {
    const out = parseExtraction("not json at all");
    expect(out).toEqual({
      complaints: [],
      scalingRationale: [],
      milestones: [],
    });
  });

  it("clamps confidence to [0, 1]", () => {
    const raw = JSON.stringify({
      complaints: [
        { topic: "x", phrase: "p", confidence: 1.5 },
        { topic: "y", phrase: "q", confidence: -0.2 },
      ],
      scalingRationale: [],
      milestones: [],
    });
    const out = parseExtraction(raw);
    expect(out.complaints[0].confidence).toBe(1);
    expect(out.complaints[1].confidence).toBe(0);
  });

  it("defaults milestone type to 'win' for unknown values", () => {
    const raw = JSON.stringify({
      complaints: [],
      scalingRationale: [],
      milestones: [{ type: "made-up", phrase: "linked unbroken" }],
    });
    const out = parseExtraction(raw);
    expect(out.milestones[0].type).toBe("win");
  });

  it("drops items missing required fields", () => {
    const raw = JSON.stringify({
      complaints: [{ topic: "shoulder" }, { phrase: "no topic" }],
      scalingRationale: [{ reason: "grip" }, { phrase: "no reason" }],
      milestones: [{}],
    });
    const out = parseExtraction(raw);
    expect(out.complaints).toEqual([]);
    expect(out.scalingRationale).toEqual([]);
    expect(out.milestones).toEqual([]);
  });
});

// ============================================
// rollupRows
// ============================================

function row(partial: {
  scoreId: string;
  workoutDate?: string;
  complaints?: NotesComplaint[];
  scalingRationale?: NotesScalingReason[];
  milestones?: NotesMilestone[];
  extractedAt?: Date;
}) {
  return {
    scoreId: partial.scoreId,
    workoutDate: partial.workoutDate ?? "2026-04-15",
    complaints: partial.complaints ?? [],
    scalingRationale: partial.scalingRationale ?? [],
    milestones: partial.milestones ?? [],
    extractedAt: partial.extractedAt ?? new Date("2026-04-29T12:00:00Z"),
  };
}

// ============================================
// formatNotesForPrompt
// ============================================

function emptyMovement(name: string, overrides?: Partial<{
  prescribedRxWeightLb: number | null;
  wasRx: boolean;
  actualWeightLb: number | null;
  movementNote: string | null;
  modification: string | null;
  substitutionMovementName: string | null;
  rxStandard: string | null;
  prescribedReps: string | null;
  prescribedDurationSeconds: number | null;
  prescribedHeightInches: number | null;
  tempo: string | null;
  isMaxReps: boolean;
  actualDurationSeconds: number | null;
  actualHeightInches: number | null;
  actualRepsPerRound: number[] | null;
}>) {
  return {
    movementName: name,
    prescribedReps: overrides?.prescribedReps ?? null,
    prescribedRxWeightLb: overrides?.prescribedRxWeightLb ?? null,
    rxStandard: overrides?.rxStandard ?? null,
    prescribedDurationSeconds: overrides?.prescribedDurationSeconds ?? null,
    prescribedHeightInches: overrides?.prescribedHeightInches ?? null,
    tempo: overrides?.tempo ?? null,
    isMaxReps: overrides?.isMaxReps ?? false,
    wasRx: overrides?.wasRx ?? true,
    actualWeightLb: overrides?.actualWeightLb ?? null,
    actualDurationSeconds: overrides?.actualDurationSeconds ?? null,
    actualHeightInches: overrides?.actualHeightInches ?? null,
    actualRepsPerRound: overrides?.actualRepsPerRound ?? null,
    modification: overrides?.modification ?? null,
    substitutionMovementName: overrides?.substitutionMovementName ?? null,
    movementNote: overrides?.movementNote ?? null,
  };
}

describe("formatNotesForPrompt", () => {
  it("includes the header when there are no notes or movements", () => {
    const out = formatNotesForPrompt({
      scoreId: "s1",
      workoutDate: "2026-04-29",
      workoutTitle: null,
      workoutType: "for_time",
      athleteGender: null,
      scoreNote: null,
      movements: [],
    });
    expect(out).toContain("Workout date: 2026-04-29");
    expect(out).toContain("Type: for_time");
    expect(out).not.toContain("Score note");
    expect(out).not.toContain("Movements");
    expect(out).not.toContain("Movement notes");
  });

  it("renders prescribed RX vs actual for each movement", () => {
    const out = formatNotesForPrompt({
      scoreId: "s1",
      workoutDate: "2026-04-29",
      workoutTitle: "DB Triplet",
      workoutType: "for_time",
      athleteGender: "female",
      scoreNote: null,
      movements: [
        emptyMovement("DB Deadlift", {
          prescribedRxWeightLb: 50,
          wasRx: false,
          actualWeightLb: 35,
        }),
        emptyMovement("DB Push Jerk", {
          prescribedRxWeightLb: 50,
          wasRx: false,
          actualWeightLb: 35,
        }),
      ],
    });
    expect(out).toContain("Title: DB Triplet");
    expect(out).toContain("Athlete gender: female");
    expect(out).toContain("DB Deadlift");
    expect(out).toContain("RX 50 lb");
    expect(out).toContain("used 35 lb");
    expect(out).toContain("scaled");
  });

  it("includes the score note when present", () => {
    const out = formatNotesForPrompt({
      scoreId: "s1",
      workoutDate: "2026-04-29",
      workoutTitle: null,
      workoutType: "for_time",
      athleteGender: "female",
      scoreNote: "felt heavy on bench, lost arm strength near the end",
      movements: [],
    });
    expect(out).toContain("Score note");
    expect(out).toContain("lost arm strength");
  });

  it("includes a movement-attached note prefixed with the movement name", () => {
    const out = formatNotesForPrompt({
      scoreId: "s1",
      workoutDate: "2026-04-29",
      workoutTitle: null,
      workoutType: "amrap",
      athleteGender: "female",
      scoreNote: null,
      movements: [
        emptyMovement("Pull-up", {
          movementNote: "had to scale to banded — grip",
        }),
        emptyMovement("Deadlift", { movementNote: null }),
      ],
    });
    expect(out).toContain("Movement notes (movement is KNOWN");
    expect(out).toContain("- Pull-up: had to scale to banded");
    expect(out).not.toContain("- Deadlift: ");
  });

  it("skips a too-short score note but keeps movement notes", () => {
    const out = formatNotesForPrompt({
      scoreId: "s1",
      workoutDate: "2026-04-29",
      workoutTitle: null,
      workoutType: "for_time",
      athleteGender: null,
      scoreNote: "ok",
      movements: [
        emptyMovement("Pull-up", {
          movementNote: "shoulder bothered me on these",
        }),
      ],
    });
    expect(out).not.toContain("Score note");
    expect(out).toContain("Movement notes");
    expect(out).toContain("Pull-up");
  });
});

describe("rollupRows", () => {
  it("surfaces single-mention complaints (no ≥2 floor)", () => {
    const rows = [
      row({
        scoreId: "s1",
        complaints: [
          { topic: "shoulder", phrase: "felt off", confidence: 0.8 },
        ],
      }),
    ];
    const out = rollupRows(rows);
    expect(out.complaints).toHaveLength(1);
    expect(out.complaints[0].topic).toBe("shoulder");
    expect(out.complaints[0].mentions).toBe(1);
  });

  it("ranks complaints by mentions (recurring topics rise above one-offs)", () => {
    const rows = [
      row({
        scoreId: "s1",
        complaints: [{ topic: "shoulder", phrase: "twingy", confidence: 0.7 }],
      }),
      row({
        scoreId: "s2",
        complaints: [{ topic: "shoulder", phrase: "still off", confidence: 0.9 }],
      }),
      row({
        scoreId: "s3",
        complaints: [{ topic: "hip", phrase: "tight", confidence: 0.8 }],
      }),
    ];
    const out = rollupRows(rows);
    expect(out.complaints[0].topic).toBe("shoulder");
    expect(out.complaints[0].mentions).toBe(2);
    expect(out.complaints[1].topic).toBe("hip");
    expect(out.complaints[1].mentions).toBe(1);
  });

  it("groups complaints by topic across distinct scores", () => {
    const rows = [
      row({
        scoreId: "s1",
        workoutDate: "2026-04-10",
        complaints: [{ topic: "shoulder", phrase: "twingy", confidence: 0.7 }],
      }),
      row({
        scoreId: "s2",
        workoutDate: "2026-04-20",
        complaints: [{ topic: "shoulder", phrase: "still off", confidence: 0.9 }],
      }),
      row({
        scoreId: "s3",
        workoutDate: "2026-04-25",
        complaints: [{ topic: "shoulder", phrase: "nagging", confidence: 0.5 }],
      }),
    ];
    const out = rollupRows(rows);
    expect(out.complaints).toHaveLength(1);
    expect(out.complaints[0].topic).toBe("shoulder");
    expect(out.complaints[0].mentions).toBe(3);
    expect(out.complaints[0].lastMentionedAt).toBe("2026-04-25");
    // Highest-confidence phrase wins as the example.
    expect(out.complaints[0].examplePhrase).toBe("still off");
  });

  it("filters out low-confidence complaints", () => {
    const rows = [
      row({
        scoreId: "s1",
        complaints: [{ topic: "hip", phrase: "...", confidence: 0.2 }],
      }),
      row({
        scoreId: "s2",
        complaints: [{ topic: "hip", phrase: "...", confidence: 0.3 }],
      }),
    ];
    const out = rollupRows(rows);
    expect(out.complaints).toHaveLength(0);
  });

  it("groups scaling reasons by (movement, reason) and ranks by mentions", () => {
    const rows = [
      row({
        scoreId: "s1",
        scalingRationale: [
          { movement: "C2B", reason: "grip", phrase: "grip gave" },
        ],
      }),
      row({
        scoreId: "s2",
        scalingRationale: [
          { movement: "C2B", reason: "grip", phrase: "grip again" },
        ],
      }),
      // Different reason on same movement — single mention, surfaces below
      // the recurring one but is no longer dropped.
      row({
        scoreId: "s3",
        scalingRationale: [
          { movement: "C2B", reason: "skill", phrase: "still learning" },
        ],
      }),
    ];
    const out = rollupRows(rows);
    expect(out.scalingRationale).toHaveLength(2);
    expect(out.scalingRationale[0].movement).toBe("C2B");
    expect(out.scalingRationale[0].reason).toBe("grip");
    expect(out.scalingRationale[0].mentions).toBe(2);
    expect(out.scalingRationale[1].reason).toBe("skill");
    expect(out.scalingRationale[1].mentions).toBe(1);
  });

  it("orders milestones most-recent first and tags scoreId/workoutDate", () => {
    const rows = [
      row({
        scoreId: "s1",
        workoutDate: "2026-04-10",
        milestones: [{ type: "pr", phrase: "back squat PR" }],
      }),
      row({
        scoreId: "s2",
        workoutDate: "2026-04-25",
        milestones: [{ type: "first", phrase: "first ring MU" }],
      }),
    ];
    const out = rollupRows(rows);
    expect(out.milestones).toHaveLength(2);
    expect(out.milestones[0].workoutDate).toBe("2026-04-25");
    expect(out.milestones[0].scoreId).toBe("s2");
    expect(out.milestones[0].type).toBe("first");
  });

  it("returns scoresExtracted and lastExtractedAt", () => {
    const t1 = new Date("2026-04-20T00:00:00Z");
    const t2 = new Date("2026-04-25T00:00:00Z");
    const rows = [
      row({ scoreId: "s1", extractedAt: t1 }),
      row({ scoreId: "s2", extractedAt: t2 }),
    ];
    const out = rollupRows(rows);
    expect(out.scoresExtracted).toBe(2);
    expect(out.lastExtractedAt).toBe(t2.toISOString());
  });
});
