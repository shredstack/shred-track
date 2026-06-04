// ============================================
// Notes Insights — extraction + aggregation
// ============================================
//
// Phase 4 of CrossFit Insights. Pulls structured signal from `scores.notes`
// using Claude, stores per-score in `score_notes_extractions`, and rolls up
// per-user views for the Insights card.
//
// VIP-gated: only users with `users.is_vip = true` get processed. See
// claude_code_instructions/crossfit_smart_insights_spec.md §11.

import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import {
  crossfitWorkoutMovements,
  crossfitWorkouts,
  movements,
  scores,
  scoreMovementDetails,
  scoreMovementSignals,
  scoreNotesExtractions,
  users,
  workoutSessions,
} from "@/db/schema";
import { and, desc, eq, gte, inArray, isNotNull, or, sql } from "drizzle-orm";
import type {
  NotesComplaint,
  NotesExtraction,
  NotesMilestone,
  NotesPerformanceMetric,
  NotesPerformanceSignal,
  NotesScalingReason,
} from "@/types/crossfit";

// Bumping this string forces re-extraction of every score on the next cron
// run. Embed any meaningful prompt or schema change here.
//   v1 — initial release; score-level notes only
//   v2 — pulls per-movement notes alongside score notes; prompt uses
//        explicit movement attribution when given
//   v3 — sends full per-score scaling context (RX prescribed vs actual,
//        athlete gender) so phrases like "the other two DB movements" are
//        interpretable; also adds content_hash so note edits trigger
//        re-extraction without bumping the version
//   v4 — PushPress Parity: adds duration/height/tempo prescribed +
//        actual signals, and resolves BW-multiplier RX prescriptions
//        against athlete bodyweight before the prompt is built.
//   v5 — Adds is_max_reps + per-round actual rep counts so the LLM can
//        attribute "fade across rounds" / "saved gas for round 8" to
//        the score-bearing movement.
//   v6 — Notes Insights v2 foundation. Adds:
//        - `movement` attribution on complaints (mirrors scalingRationale)
//          so the workout-detail anticipatory banner can target the right
//          movement.
//        - `performanceSignals` top-level array of quantitative phrases
//          ("30 unbroken DUs in 1.5 min"). Feeds the prep card's
//          recent-best / stretch-goal line.
export const NOTES_MODEL_VERSION = "claude-sonnet-4-6.v6";

const CLAUDE_MODEL =
  process.env.CROSSFIT_NOTES_MODEL?.trim() || "claude-sonnet-4-6";

// Hard ceiling on what we'll send the LLM in one call. Notes are typically
// <500 chars; cap defensively.
const MAX_NOTE_CHARS = 4000;

// Minimum content to even bother extracting. Anything shorter is almost
// always one-word or a bare timestamp.
const MIN_NOTE_CHARS = 8;

// ============================================
// Types
// ============================================

export type NotesAggregateComplaint = {
  topic: string;
  mentions: number;
  scoreIds: string[];
  lastMentionedAt: string; // YYYY-MM-DD
  examplePhrase: string;
};

export type NotesAggregateScalingReason = {
  movement: string | null;
  reason: string;
  mentions: number;
  examplePhrase: string;
};

export type NotesAggregateMilestone = NotesMilestone & {
  scoreId: string;
  workoutDate: string;
};

export type NotesInsights = {
  complaints: NotesAggregateComplaint[];
  scalingRationale: NotesAggregateScalingReason[];
  milestones: NotesAggregateMilestone[];
  scoresExtracted: number;
  lastExtractedAt: string | null; // ISO timestamp
  // Notes Insights v2 — added in PR 1. Optional so older clients (if any
  // cache the prior shape) keep rendering.
  temporalCallouts?: NotesTemporalCallout[];
  rpeCallouts?: NotesRpeCallout[];
  dormantWins?: NotesDormantWin[];
};

// ============================================
// Prompt
// ============================================

const SYSTEM_PROMPT = `You analyze a CrossFit athlete's training notes for one workout and extract structured insights.

You receive three blocks of context for each workout:

1. Workout context — the movements the athlete did, with the prescribed RX weight (gender-appropriate when known) and what the athlete actually used. This tells you who scaled what and how far. References like "the other two DB movements" or "felt heavy" are interpretable through this context — use it.

2. Score note (optional) — the athlete's overall reflection on the workout. Movements aren't explicitly attached; the athlete may name them or refer to them indirectly ("the deadlifts," "those," "two of them").

3. Movement notes (optional) — notes the athlete attached to a specific movement. The movement name IS KNOWN and prefixed before the note text. Trust it.

Return ONLY valid JSON matching this schema:
{
  "complaints": [
    { "topic": string, "movement": string | null, "phrase": string, "confidence": number }
  ],
  "scalingRationale": [
    { "movement": string | null, "reason": string, "phrase": string }
  ],
  "milestones": [
    { "type": "first" | "pr" | "win", "phrase": string }
  ],
  "performanceSignals": [
    {
      "movement": string,
      "metric": "unbroken_reps" | "reps_in_window" | "set_split" | "pace" | "load_for_reps",
      "value": number,
      "unit": string,
      "window": string | null,
      "qualitative": "better" | "same" | "worse" | null,
      "phrase": string
    }
  ]
}

Definitions:
- complaints: Body parts, injuries, fatigue, lost capacity, or repeated discomfort. \`topic\` is a short canonical noun ("shoulder", "low back", "grip", "hip", "arm strength", "endurance", "shoulder strength"). Capture lost-strength, "felt weak", or "harder than expected" mentions when the athlete frames them as a problem. When the workout context names the movement the complaint is about (e.g. a movement note explicitly attached to T2B that says "grip gave out"), set \`movement\` to that canonical name. Otherwise set \`movement\` to null. Do not guess. \`phrase\` is the verbatim snippet. \`confidence\` is 0..1 — 1.0 if explicit, 0.6–0.8 for clear-but-implicit, 0.4 for vague.
- scalingRationale: Reasons that explain why the athlete scaled (used a lighter weight, easier variant, fewer reps, banded version, etc.). Cross-reference the workout context to attribute correctly:
  - For a Movement note, ALWAYS use the prefixed movement name.
  - For a Score note that refers to multiple movements ("the other two DB movements"), emit ONE entry per movement the athlete is referring to, using the workout-context movement names.
  - When the athlete describes a difficulty without explicitly mentioning scaling, but the workout context shows they DID scale that movement, you may still infer the rationale.
  - \`reason\` is a short canonical phrase ("grip", "shoulder pain", "skill", "intensity", "strength", "endurance").
  - If you can't tie a difficulty to a specific scaled movement and no movement is explicitly named, set \`movement\` to null.
- milestones: First-time achievements ("first time", "PR", "linked unbroken"), wins, or breakthroughs. \`type\` is "first" for firsts, "pr" for PRs, "win" otherwise.
- performanceSignals: Quantitative phrases the athlete wrote about a specific movement. Examples:
  - "30 unbroken DUs in 1.5 min" → { movement: "Double Unders", metric: "reps_in_window", value: 30, unit: "reps", window: "1.5 min", qualitative: "better", phrase: "30 unbroken in 1.5 min" }
  - "Held a 1:55 / 500m on the row" → { movement: "Row", metric: "pace", value: 115, unit: "sec", window: "500m", qualitative: null, phrase: "1:55 / 500m" }
  Only emit signals where you can attribute the metric to a SPECIFIC movement (use the workout context to pick the canonical movement name). Required fields: \`movement\` (string, non-empty), \`metric\` (one of the enum values), \`value\` (number), \`unit\` (e.g. "reps", "sec", "m", "lb"). \`window\` is the time/AMRAP/distance bound when the metric needs it (e.g. "1.5 min", "10:00 AMRAP", "500m"), else null. \`qualitative\` is "better" / "same" / "worse" only when the athlete explicitly compares to past performance, else null. Do not invent numbers not in the note.

A single note can produce zero, one, or many items in any field. Empty arrays are valid. Do not invent items not present in the notes. Generic statements like "got it done" with no specific signal yield empty arrays. No markdown, no explanation — just the JSON object.`;

// ============================================
// Public extraction entry
// ============================================

// One movement's prescribed/actual context for a single score, plus the
// movement-level note if any. This is what we feed the LLM so it can
// interpret references like "the other two DB movements".
export type MovementContext = {
  movementName: string;
  prescribedReps: string | null;
  prescribedRxWeightLb: number | null; // gender-resolved RX weight in lb
  rxStandard: string | null;
  // PushPress Parity additions — extra prescribed signal the LLM uses to
  // attribute "the deadlifts felt heavy" / "couldn't hold the L-sit".
  prescribedDurationSeconds: number | null;
  prescribedHeightInches: number | null;
  tempo: string | null;
  // True when the movement is the score-bearing "max reps" movement of
  // the part. The LLM can attribute "fade across rounds" / "saved gas
  // for round 8" comments to it.
  isMaxReps: boolean;
  wasRx: boolean;
  actualWeightLb: number | null;
  actualDurationSeconds: number | null;
  actualHeightInches: number | null;
  // Per-round rep counts when this is a max-reps movement. Same length
  // as part.rounds.
  actualRepsPerRound: number[] | null;
  modification: string | null;
  substitutionMovementName: string | null;
  movementNote: string | null;
};

export type RawScoreNote = {
  scoreId: string;
  workoutDate: string;
  workoutTitle: string | null;
  workoutType: string;
  athleteGender: "male" | "female" | "other" | null;
  scoreNote: string | null;
  movements: MovementContext[];
};

function describeMovement(m: MovementContext): string {
  const bits: string[] = [];

  // Prescribed side. We compose this directly from MovementContext (rather
  // than calling formatMovementPrescription) because the context shape
  // already carries the resolved RX weight (BW multipliers handled at
  // listScoresNeedingExtraction time, with the athlete's stored
  // body_weight_lb).
  const prescribed: string[] = [];
  if (m.isMaxReps) prescribed.push("MAX reps (score-bearing)");
  if (m.prescribedReps) prescribed.push(m.prescribedReps);
  if (m.prescribedDurationSeconds != null) {
    prescribed.push(`${m.prescribedDurationSeconds}s prescribed`);
  }
  if (m.prescribedRxWeightLb != null) {
    prescribed.push(`RX ${m.prescribedRxWeightLb} lb`);
  } else if (m.rxStandard) {
    prescribed.push(`RX: ${m.rxStandard}`);
  }
  if (m.tempo) prescribed.push(`tempo ${m.tempo}`);
  if (m.prescribedHeightInches != null) {
    prescribed.push(`${m.prescribedHeightInches} in height`);
  }
  const prescribedStr = prescribed.length > 0 ? ` (${prescribed.join(", ")})` : "";

  bits.push(`${m.movementName}${prescribedStr}`);

  // Actual side
  const actual: string[] = [];
  if (m.substitutionMovementName) {
    actual.push(`substituted with ${m.substitutionMovementName}`);
  }
  if (m.actualWeightLb != null) {
    actual.push(`used ${m.actualWeightLb} lb`);
  }
  if (m.actualDurationSeconds != null) {
    actual.push(`held ${m.actualDurationSeconds}s`);
  }
  if (m.actualHeightInches != null) {
    actual.push(`actual height ${m.actualHeightInches} in`);
  }
  if (m.actualRepsPerRound && m.actualRepsPerRound.length > 0) {
    const total = m.actualRepsPerRound.reduce((a, b) => a + b, 0);
    actual.push(
      `per-round reps: [${m.actualRepsPerRound.join(", ")}] (total ${total})`
    );
  }
  if (m.modification) {
    actual.push(`modification: ${m.modification}`);
  }
  actual.push(m.wasRx ? "RX" : "scaled");
  bits.push(`→ ${actual.join(", ")}`);

  return `- ${bits.join(" ")}`;
}

// Build the user-prompt body. Exported for testability — keeps the formatting
// inspectable so we can unit-test how attribution flows into the LLM.
export function formatNotesForPrompt(note: RawScoreNote): string {
  const sections: string[] = [];

  // Header block — workout meta
  const headerLines = [`Workout date: ${note.workoutDate}`];
  if (note.workoutTitle) headerLines.push(`Title: ${note.workoutTitle}`);
  headerLines.push(`Type: ${note.workoutType}`);
  if (note.athleteGender) {
    headerLines.push(`Athlete gender: ${note.athleteGender}`);
  }
  sections.push(headerLines.join("\n"));

  // Workout context (movements with prescribed vs actual)
  if (note.movements.length > 0) {
    const lines = note.movements.map(describeMovement).join("\n");
    sections.push(`Movements (prescribed → what the athlete did):\n${lines}`);
  }

  // Score note
  const score = (note.scoreNote ?? "").trim();
  if (score.length >= MIN_NOTE_CHARS) {
    sections.push(
      `Score note (overall workout):\n${score.slice(0, MAX_NOTE_CHARS)}`
    );
  }

  // Movement-attached notes
  const movementNotes = note.movements
    .filter(
      (m) => m.movementNote && m.movementNote.trim().length >= MIN_NOTE_CHARS
    )
    .map(
      (m) =>
        `- ${m.movementName}: ${m.movementNote!.trim().slice(0, MAX_NOTE_CHARS)}`
    );

  if (movementNotes.length > 0) {
    sections.push(
      `Movement notes (movement is KNOWN — use it):\n${movementNotes.join("\n")}`
    );
  }

  return sections.join("\n\n");
}

// Returns true when there is at least one note worth sending to the LLM.
function hasUsableContent(note: RawScoreNote): boolean {
  const score = (note.scoreNote ?? "").trim();
  if (score.length >= MIN_NOTE_CHARS) return true;
  return note.movements.some(
    (m) => m.movementNote && m.movementNote.trim().length >= MIN_NOTE_CHARS
  );
}

// SHA-256 over the exact prompt we send. When the prompt body changes
// (notes edited, scaling re-recorded, etc.) the hash flips and the next
// cron run picks the score back up.
export function computeContentHash(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 32);
}

export type ExtractionWithHash = {
  extraction: NotesExtraction;
  contentHash: string;
};

export async function extractNoteForScore(
  note: RawScoreNote,
  client?: Anthropic
): Promise<ExtractionWithHash> {
  const userPrompt = formatNotesForPrompt(note);
  const contentHash = computeContentHash(userPrompt);

  if (!hasUsableContent(note)) {
    return {
      extraction: {
        complaints: [],
        scalingRationale: [],
        milestones: [],
        performanceSignals: [],
      },
      contentHash,
    };
  }

  const c = client ?? new Anthropic({ maxRetries: 0 });
  const response = await c.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    // System prompt is cached: every score in the same cron tick reuses it,
    // so per-call cost drops to user-prompt + output tokens after the first.
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }
  return { extraction: parseExtraction(textBlock.text), contentHash };
}

// Strip code fences, parse, and re-shape into our types defensively. We do
// NOT throw on a partial-shape response — we return the empty extraction so
// one bad note doesn't poison the whole batch.
export function parseExtraction(raw: string): NotesExtraction {
  const cleaned = raw
    .replace(/^```(?:json)?\n?/g, "")
    .replace(/\n?```$/g, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return emptyExtraction();
  }

  if (!parsed || typeof parsed !== "object") {
    return emptyExtraction();
  }

  const obj = parsed as Record<string, unknown>;
  return {
    complaints: coerceComplaints(obj.complaints),
    scalingRationale: coerceScalingReasons(obj.scalingRationale),
    milestones: coerceMilestones(obj.milestones),
    performanceSignals: coercePerformanceSignals(obj.performanceSignals),
  };
}

function emptyExtraction(): NotesExtraction {
  return {
    complaints: [],
    scalingRationale: [],
    milestones: [],
    performanceSignals: [],
  };
}

function coerceComplaints(raw: unknown): NotesComplaint[] {
  if (!Array.isArray(raw)) return [];
  const out: NotesComplaint[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.topic !== "string" || typeof r.phrase !== "string") continue;
    const conf = typeof r.confidence === "number" ? r.confidence : 0.5;
    const movement =
      typeof r.movement === "string" && r.movement.trim().length > 0
        ? r.movement.trim()
        : null;
    out.push({
      topic: r.topic.trim().toLowerCase(),
      movement,
      phrase: r.phrase.trim(),
      confidence: Math.max(0, Math.min(1, conf)),
    });
  }
  return out;
}

const PERFORMANCE_METRIC_VALUES: ReadonlySet<NotesPerformanceMetric> = new Set([
  "unbroken_reps",
  "reps_in_window",
  "set_split",
  "pace",
  "load_for_reps",
]);

const QUALITATIVE_VALUES: ReadonlySet<"better" | "same" | "worse"> = new Set([
  "better",
  "same",
  "worse",
]);

export function coercePerformanceSignals(
  raw: unknown
): NotesPerformanceSignal[] {
  if (!Array.isArray(raw)) return [];
  const out: NotesPerformanceSignal[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    // movement is required and must be a non-empty string
    const movement =
      typeof r.movement === "string" ? r.movement.trim() : "";
    if (!movement) continue;
    // metric must be one of the allowed enum values
    if (typeof r.metric !== "string") continue;
    if (!PERFORMANCE_METRIC_VALUES.has(r.metric as NotesPerformanceMetric)) {
      continue;
    }
    // value must be a finite number
    if (typeof r.value !== "number" || !Number.isFinite(r.value)) continue;
    // unit and phrase must be non-empty strings
    if (typeof r.unit !== "string" || r.unit.trim().length === 0) continue;
    if (typeof r.phrase !== "string" || r.phrase.trim().length === 0) continue;
    const window =
      typeof r.window === "string" && r.window.trim().length > 0
        ? r.window.trim()
        : null;
    const qualitative =
      typeof r.qualitative === "string" &&
      QUALITATIVE_VALUES.has(r.qualitative as "better" | "same" | "worse")
        ? (r.qualitative as "better" | "same" | "worse")
        : null;
    out.push({
      movement,
      metric: r.metric as NotesPerformanceMetric,
      value: r.value,
      unit: r.unit.trim(),
      window,
      qualitative,
      phrase: r.phrase.trim(),
    });
  }
  return out;
}

function coerceScalingReasons(raw: unknown): NotesScalingReason[] {
  if (!Array.isArray(raw)) return [];
  const out: NotesScalingReason[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.reason !== "string" || typeof r.phrase !== "string") continue;
    out.push({
      movement: typeof r.movement === "string" ? r.movement.trim() : null,
      reason: r.reason.trim().toLowerCase(),
      phrase: r.phrase.trim(),
    });
  }
  return out;
}

function coerceMilestones(raw: unknown): NotesMilestone[] {
  if (!Array.isArray(raw)) return [];
  const out: NotesMilestone[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.phrase !== "string") continue;
    const t =
      r.type === "first" || r.type === "pr" || r.type === "win"
        ? r.type
        : "win";
    out.push({ type: t, phrase: r.phrase.trim() });
  }
  return out;
}

// ============================================
// Cron worker — pulls outstanding scores and writes results
// ============================================

export type ExtractionRunSummary = {
  userId: string;
  considered: number;
  extracted: number;
  errors: number;
};

// Existing extraction snapshot, used to decide whether a score needs to
// be re-processed.
type ExistingExtraction = {
  scoreId: string;
  modelVersion: string;
  contentHash: string | null;
};

// Resolve the gender-appropriate prescribed RX weight for a movement.
// Falls back to the male RX when gender is unknown. Now also resolves
// % bodyweight prescriptions when the athlete has logged their bodyweight.
function resolveRxWeight(
  gender: "male" | "female" | "other" | null,
  male: number | null,
  female: number | null,
  maleBwMultiplier: number | null = null,
  femaleBwMultiplier: number | null = null,
  bodyWeightLb: number | null = null
): number | null {
  if (gender === "female") {
    if (female != null) return female;
    if (femaleBwMultiplier != null && bodyWeightLb != null) {
      return Math.round(femaleBwMultiplier * bodyWeightLb);
    }
    if (male != null) return male;
    if (maleBwMultiplier != null && bodyWeightLb != null) {
      return Math.round(maleBwMultiplier * bodyWeightLb);
    }
    return null;
  }
  if (male != null) return male;
  if (maleBwMultiplier != null && bodyWeightLb != null) {
    return Math.round(maleBwMultiplier * bodyWeightLb);
  }
  if (female != null) return female;
  if (femaleBwMultiplier != null && bodyWeightLb != null) {
    return Math.round(femaleBwMultiplier * bodyWeightLb);
  }
  return null;
}

export async function listScoresNeedingExtraction(
  userId: string,
  modelVersion: string,
  limit: number
): Promise<RawScoreNote[]> {
  // Step 1: athlete's gender + bodyweight (both drive RX weight resolution).
  const [athleteRow] = await db
    .select({ gender: users.gender, bodyWeightLb: users.bodyWeightLb })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const athleteGender = normalizeGender(athleteRow?.gender ?? null);
  const athleteBodyWeightLb =
    athleteRow?.bodyWeightLb != null ? Number(athleteRow.bodyWeightLb) : null;

  // Step 2: candidate scores — those that have either a score-level note OR
  // at least one movement-level note. Order by date desc so newest-first.
  // workoutTitle: prefer the session's title override (set by coaches on
  // programmed days); fall back to the template title.
  const candidateRows = await db
    .selectDistinct({
      scoreId: scores.id,
      scoreNote: scores.notes,
      workoutDate: workoutSessions.workoutDate,
      workoutTitle: sql<string>`COALESCE(${workoutSessions.title}, ${crossfitWorkouts.title})`,
      workoutType: crossfitWorkouts.workoutType,
    })
    .from(scores)
    .innerJoin(workoutSessions, eq(workoutSessions.id, scores.workoutSessionId))
    .innerJoin(
      crossfitWorkouts,
      eq(crossfitWorkouts.id, workoutSessions.crossfitWorkoutId)
    )
    .leftJoin(
      scoreMovementDetails,
      eq(scoreMovementDetails.scoreId, scores.id)
    )
    .where(
      and(
        eq(scores.userId, userId),
        or(isNotNull(scores.notes), isNotNull(scoreMovementDetails.notes))
      )
    )
    .orderBy(desc(workoutSessions.workoutDate))
    .limit(limit * 4);

  if (candidateRows.length === 0) return [];

  const candidateIds = candidateRows.map((c) => c.scoreId);

  // Step 3: existing extractions for those candidates. We need the hash too
  // so we can later decide whether content changed even at the same model.
  const existing = await db
    .select({
      scoreId: scoreNotesExtractions.scoreId,
      modelVersion: scoreNotesExtractions.modelVersion,
      contentHash: scoreNotesExtractions.contentHash,
    })
    .from(scoreNotesExtractions)
    .where(inArray(scoreNotesExtractions.scoreId, candidateIds));

  const existingByScore = new Map<string, ExistingExtraction>();
  for (const e of existing) existingByScore.set(e.scoreId, e);

  // Step 4: fetch every movement row (with its scaling context AND its note)
  // for the candidates in one shot.
  const movementRows = await db
    .select({
      scoreId: scoreMovementDetails.scoreId,
      orderIndex: crossfitWorkoutMovements.orderIndex,
      canonicalName: movements.canonicalName,
      prescribedReps: crossfitWorkoutMovements.prescribedReps,
      prescribedWeightMale: crossfitWorkoutMovements.prescribedWeightMale,
      prescribedWeightFemale: crossfitWorkoutMovements.prescribedWeightFemale,
      prescribedDurationSecondsMale:
        crossfitWorkoutMovements.prescribedDurationSecondsMale,
      prescribedDurationSecondsFemale:
        crossfitWorkoutMovements.prescribedDurationSecondsFemale,
      prescribedHeightInches: crossfitWorkoutMovements.prescribedHeightInches,
      prescribedWeightMaleBwMultiplier:
        crossfitWorkoutMovements.prescribedWeightMaleBwMultiplier,
      prescribedWeightFemaleBwMultiplier:
        crossfitWorkoutMovements.prescribedWeightFemaleBwMultiplier,
      tempo: crossfitWorkoutMovements.tempo,
      isMaxReps: crossfitWorkoutMovements.isMaxReps,
      rxStandard: crossfitWorkoutMovements.rxStandard,
      wasRx: scoreMovementDetails.wasRx,
      actualWeight: scoreMovementDetails.actualWeight,
      actualDurationSeconds: scoreMovementDetails.actualDurationSeconds,
      actualHeightInches: scoreMovementDetails.actualHeightInches,
      actualRepsPerRound: scoreMovementDetails.actualRepsPerRound,
      modification: scoreMovementDetails.modification,
      substitutionMovementId: scoreMovementDetails.substitutionMovementId,
      movementNote: scoreMovementDetails.notes,
    })
    .from(scoreMovementDetails)
    .innerJoin(
      crossfitWorkoutMovements,
      eq(
        crossfitWorkoutMovements.id,
        scoreMovementDetails.crossfitWorkoutMovementId
      )
    )
    .innerJoin(movements, eq(movements.id, crossfitWorkoutMovements.movementId))
    .where(inArray(scoreMovementDetails.scoreId, candidateIds));

  // Step 5: substitution movement names (separate query — small)
  const subIds = movementRows
    .map((r) => r.substitutionMovementId)
    .filter((v): v is string => v != null);
  const subNamesById = new Map<string, string>();
  if (subIds.length > 0) {
    const subRows = await db
      .select({ id: movements.id, name: movements.canonicalName })
      .from(movements)
      .where(inArray(movements.id, subIds));
    for (const s of subRows) subNamesById.set(s.id, s.name);
  }

  // Step 6: shape per-score MovementContext lists, ordered by orderIndex.
  const movementsByScore = new Map<string, MovementContext[]>();
  for (const r of movementRows) {
    const prescribedDuration =
      athleteGender === "female"
        ? r.prescribedDurationSecondsFemale ??
          r.prescribedDurationSecondsMale ??
          null
        : r.prescribedDurationSecondsMale ??
          r.prescribedDurationSecondsFemale ??
          null;
    const ctx: MovementContext = {
      movementName: r.canonicalName,
      prescribedReps: r.prescribedReps,
      prescribedRxWeightLb: resolveRxWeight(
        athleteGender,
        r.prescribedWeightMale != null ? Number(r.prescribedWeightMale) : null,
        r.prescribedWeightFemale != null
          ? Number(r.prescribedWeightFemale)
          : null,
        r.prescribedWeightMaleBwMultiplier != null
          ? Number(r.prescribedWeightMaleBwMultiplier)
          : null,
        r.prescribedWeightFemaleBwMultiplier != null
          ? Number(r.prescribedWeightFemaleBwMultiplier)
          : null,
        athleteBodyWeightLb
      ),
      rxStandard: r.rxStandard,
      prescribedDurationSeconds: prescribedDuration,
      prescribedHeightInches:
        r.prescribedHeightInches != null
          ? Number(r.prescribedHeightInches)
          : null,
      tempo: r.tempo,
      isMaxReps: !!r.isMaxReps,
      wasRx: r.wasRx,
      actualWeightLb: r.actualWeight != null ? Number(r.actualWeight) : null,
      actualDurationSeconds: r.actualDurationSeconds,
      actualHeightInches:
        r.actualHeightInches != null ? Number(r.actualHeightInches) : null,
      actualRepsPerRound:
        r.actualRepsPerRound && r.actualRepsPerRound.length > 0
          ? r.actualRepsPerRound
          : null,
      modification: r.modification,
      substitutionMovementName:
        r.substitutionMovementId
          ? subNamesById.get(r.substitutionMovementId) ?? null
          : null,
      movementNote: r.movementNote,
    };
    const list = movementsByScore.get(r.scoreId) ?? [];
    list.push(ctx);
    movementsByScore.set(r.scoreId, list);
  }
  for (const list of movementsByScore.values()) {
    list.sort((a, b) => a.movementName.localeCompare(b.movementName));
  }

  // Step 7: build candidate RawScoreNote objects, decide which need work
  // by comparing model_version + content_hash. We compute the hash off the
  // actual formatted prompt so any change to the source data flips it.
  const out: RawScoreNote[] = [];
  for (const c of candidateRows) {
    if (out.length >= limit) break;

    const scoreMovements = movementsByScore.get(c.scoreId) ?? [];
    const trimmedScoreNote = c.scoreNote?.trim() ?? "";
    const hasScoreNote = trimmedScoreNote.length >= MIN_NOTE_CHARS;
    const hasMovementNote = scoreMovements.some(
      (m) => m.movementNote && m.movementNote.trim().length >= MIN_NOTE_CHARS
    );
    if (!hasScoreNote && !hasMovementNote) continue;

    const candidate: RawScoreNote = {
      scoreId: c.scoreId,
      workoutDate: c.workoutDate,
      workoutTitle: c.workoutTitle,
      workoutType: c.workoutType,
      athleteGender,
      scoreNote: hasScoreNote ? c.scoreNote : null,
      movements: scoreMovements,
    };

    const prompt = formatNotesForPrompt(candidate);
    const hash = computeContentHash(prompt);

    const prior = existingByScore.get(c.scoreId);
    const upToDate =
      prior?.modelVersion === modelVersion && prior?.contentHash === hash;
    if (upToDate) continue;

    out.push(candidate);
  }
  return out;
}

function normalizeGender(
  raw: string | null
): "male" | "female" | "other" | null {
  if (raw === "male" || raw === "female" || raw === "other") return raw;
  return null;
}

// Persist a single extraction. Idempotent on (score_id) — overwrites any
// older model_version or content_hash. Also keeps the denormalized
// `score_movement_signals` table in lockstep by deleting every prior row
// for this score and re-inserting whatever the new extraction emitted.
//
// userId + workoutDate are required for the denormalized rows; the cron
// already has them (the candidate RawScoreNote carries workoutDate and the
// worker iterates per user). Passing them in keeps this function free of
// extra lookups.
export async function saveExtraction(
  scoreId: string,
  extraction: NotesExtraction,
  modelVersion: string,
  contentHash: string,
  meta: { userId: string; workoutDate: string }
): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .insert(scoreNotesExtractions)
      .values({
        scoreId,
        complaints: extraction.complaints,
        scalingRationale: extraction.scalingRationale,
        milestones: extraction.milestones,
        performanceSignals: extraction.performanceSignals,
        modelVersion,
        contentHash,
        extractedAt: now,
      })
      .onConflictDoUpdate({
        target: scoreNotesExtractions.scoreId,
        set: {
          complaints: extraction.complaints,
          scalingRationale: extraction.scalingRationale,
          milestones: extraction.milestones,
          performanceSignals: extraction.performanceSignals,
          modelVersion,
          contentHash,
          extractedAt: now,
        },
      });

    await tx
      .delete(scoreMovementSignals)
      .where(eq(scoreMovementSignals.scoreId, scoreId));

    if (extraction.performanceSignals.length > 0) {
      await tx.insert(scoreMovementSignals).values(
        extraction.performanceSignals.map((s) => ({
          scoreId,
          userId: meta.userId,
          movementName: s.movement,
          metric: s.metric,
          value: s.value.toString(),
          unit: s.unit,
          window: s.window,
          qualitative: s.qualitative,
          phrase: s.phrase,
          workoutDate: meta.workoutDate,
          extractedAt: now,
        }))
      );
    }
  });
}

// ============================================
// Aggregation for the API
// ============================================

const AGGREGATE_WINDOW_DAYS = 365;
const TOP_N_COMPLAINTS = 6;
const TOP_N_REASONS = 6;
const RECENT_MILESTONES = 8;
const COMPLAINT_MIN_CONFIDENCE = 0.4;

function daysAgoIso(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export async function aggregateNotesForUser(
  userId: string
): Promise<NotesInsights> {
  const since = daysAgoIso(AGGREGATE_WINDOW_DAYS);

  const rows = await db
    .select({
      scoreId: scoreNotesExtractions.scoreId,
      complaints: scoreNotesExtractions.complaints,
      scalingRationale: scoreNotesExtractions.scalingRationale,
      milestones: scoreNotesExtractions.milestones,
      extractedAt: scoreNotesExtractions.extractedAt,
      workoutDate: workoutSessions.workoutDate,
    })
    .from(scoreNotesExtractions)
    .innerJoin(scores, eq(scores.id, scoreNotesExtractions.scoreId))
    .innerJoin(workoutSessions, eq(workoutSessions.id, scores.workoutSessionId))
    .where(
      and(eq(scores.userId, userId), gte(workoutSessions.workoutDate, since))
    );

  if (rows.length === 0) {
    return {
      complaints: [],
      scalingRationale: [],
      milestones: [],
      scoresExtracted: 0,
      lastExtractedAt: null,
    };
  }

  return rollupRows(rows);
}

type RollupRow = {
  scoreId: string;
  workoutDate: string;
  complaints: NotesComplaint[];
  scalingRationale: NotesScalingReason[];
  milestones: NotesMilestone[];
  extractedAt: Date;
};

export function rollupRows(rows: RollupRow[]): NotesInsights {
  // Complaints: group by topic. Only count items above min confidence.
  const complaintMap = new Map<
    string,
    {
      topic: string;
      scoreIds: Set<string>;
      lastDate: string;
      examplePhrase: string;
      bestConfidence: number;
    }
  >();

  for (const row of rows) {
    for (const c of row.complaints) {
      if (c.confidence < COMPLAINT_MIN_CONFIDENCE) continue;
      const key = c.topic;
      const cur = complaintMap.get(key);
      if (!cur) {
        complaintMap.set(key, {
          topic: c.topic,
          scoreIds: new Set([row.scoreId]),
          lastDate: row.workoutDate,
          examplePhrase: c.phrase,
          bestConfidence: c.confidence,
        });
      } else {
        cur.scoreIds.add(row.scoreId);
        if (row.workoutDate > cur.lastDate) cur.lastDate = row.workoutDate;
        if (c.confidence > cur.bestConfidence) {
          cur.bestConfidence = c.confidence;
          cur.examplePhrase = c.phrase;
        }
      }
    }
  }

  // No "≥2 mentions" floor: top-N + the per-item confidence floor are the
  // only filters. As the dataset grows, recurring topics rise to the top of
  // the sort and one-offs naturally fall below the cap.
  const complaintsOut: NotesAggregateComplaint[] = Array.from(
    complaintMap.values()
  )
    .map((c) => ({
      topic: c.topic,
      mentions: c.scoreIds.size,
      scoreIds: Array.from(c.scoreIds),
      lastMentionedAt: c.lastDate,
      examplePhrase: c.examplePhrase,
    }))
    .sort((a, b) => b.mentions - a.mentions || b.lastMentionedAt.localeCompare(a.lastMentionedAt))
    .slice(0, TOP_N_COMPLAINTS);

  // Scaling reasons: group by (movement, reason).
  const reasonMap = new Map<
    string,
    {
      movement: string | null;
      reason: string;
      mentions: number;
      examplePhrase: string;
    }
  >();
  for (const row of rows) {
    for (const r of row.scalingRationale) {
      const movement = r.movement?.trim() || null;
      const key = `${movement ?? "*"}::${r.reason}`;
      const cur = reasonMap.get(key);
      if (!cur) {
        reasonMap.set(key, {
          movement,
          reason: r.reason,
          mentions: 1,
          examplePhrase: r.phrase,
        });
      } else {
        cur.mentions += 1;
      }
    }
  }
  const reasonsOut: NotesAggregateScalingReason[] = Array.from(
    reasonMap.values()
  )
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, TOP_N_REASONS);

  // Milestones: most recent first. We expose individual events; recency
  // matters more than aggregation here.
  const milestonesOut: NotesAggregateMilestone[] = [];
  for (const row of rows) {
    for (const m of row.milestones) {
      milestonesOut.push({
        ...m,
        scoreId: row.scoreId,
        workoutDate: row.workoutDate,
      });
    }
  }
  milestonesOut.sort((a, b) => b.workoutDate.localeCompare(a.workoutDate));

  let lastExtracted: Date | null = null;
  for (const r of rows) {
    if (!lastExtracted || r.extractedAt > lastExtracted) {
      lastExtracted = r.extractedAt;
    }
  }

  return {
    complaints: complaintsOut,
    scalingRationale: reasonsOut,
    milestones: milestonesOut.slice(0, RECENT_MILESTONES),
    scoresExtracted: rows.length,
    lastExtractedAt: lastExtracted ? lastExtracted.toISOString() : null,
  };
}

// ============================================
// New aggregators — Notes Insights v2 (PR 1)
//
// All three are pure functions over already-fetched rows so they can be
// unit-tested without hitting the DB. The exported `aggregate*ForUser`
// wrappers handle the query side. See
// claude_code_instructions/crossfit_improvements/notes_insights_v2_spec.md §5.
// ============================================

// ---------- (a) Day-of-week / post-rest temporal callouts ----------

const TEMPORAL_WINDOW_DAYS = 180;
const TEMPORAL_MIN_MENTIONS = 4;
const TEMPORAL_MIN_LIFT = 2;
const POST_REST_GAP_DAYS = 2;
const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type NotesTemporalCallout = {
  dimension: "dow" | "tod" | "post_rest";
  bucket: string;
  topic: string;
  mentions: number;
  baselineMentions: number;
};

// Per-session row used by the temporal aggregator. Each row is one score
// with its workout date and the topics the LLM extracted (deduped per
// score so two phrases for the same topic don't double-count the day).
export type TemporalRow = {
  scoreId: string;
  workoutDate: string; // YYYY-MM-DD
  topics: string[]; // distinct, lowercased
};

export function aggregateTemporalComplaintsFromRows(
  rows: TemporalRow[]
): NotesTemporalCallout[] {
  if (rows.length === 0) return [];

  // Sort so we can compute prior-workout gaps in one pass.
  const sorted = [...rows].sort((a, b) =>
    a.workoutDate.localeCompare(b.workoutDate)
  );

  // Pass 1: figure out which sessions came after a ≥2-day gap.
  const isPostRestById = new Map<string, boolean>();
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0) {
      // Can't infer a gap for the first session in the window — treat as
      // not-post-rest so it doesn't get a false positive.
      isPostRestById.set(sorted[i].scoreId, false);
      continue;
    }
    const cur = parseIsoDate(sorted[i].workoutDate);
    const prev = parseIsoDate(sorted[i - 1].workoutDate);
    if (!cur || !prev) {
      isPostRestById.set(sorted[i].scoreId, false);
      continue;
    }
    const diffDays = Math.round(
      (cur.getTime() - prev.getTime()) / (24 * 60 * 60 * 1000)
    );
    isPostRestById.set(sorted[i].scoreId, diffDays >= POST_REST_GAP_DAYS);
  }

  // Pass 2: tally per-bucket session counts + per-(bucket, topic) mentions.
  // Keys: dow bucket = "Mon" ... "Sun"; post_rest bucket = "after rest" or
  // "between" (we only surface "after rest").
  const dowSessionCount = new Map<string, number>(); // bucket → sessions
  const dowMentions = new Map<string, Map<string, number>>(); // bucket → topic → mentions
  let postRestSessions = 0;
  let nonPostRestSessions = 0;
  const postRestMentions = new Map<string, number>(); // topic → mentions
  const nonPostRestMentions = new Map<string, number>(); // topic → mentions

  for (const row of sorted) {
    const d = parseIsoDate(row.workoutDate);
    if (!d) continue;
    const dow = DOW_LABELS[d.getUTCDay()];

    dowSessionCount.set(dow, (dowSessionCount.get(dow) ?? 0) + 1);
    const isPostRest = isPostRestById.get(row.scoreId) ?? false;
    if (isPostRest) postRestSessions += 1;
    else nonPostRestSessions += 1;

    const uniq = new Set(row.topics);
    for (const topic of uniq) {
      if (!topic) continue;
      let topicMap = dowMentions.get(dow);
      if (!topicMap) {
        topicMap = new Map();
        dowMentions.set(dow, topicMap);
      }
      topicMap.set(topic, (topicMap.get(topic) ?? 0) + 1);

      if (isPostRest) {
        postRestMentions.set(topic, (postRestMentions.get(topic) ?? 0) + 1);
      } else {
        nonPostRestMentions.set(
          topic,
          (nonPostRestMentions.get(topic) ?? 0) + 1
        );
      }
    }
  }

  const out: NotesTemporalCallout[] = [];

  // DOW: for each (bucket, topic), compare bucket rate to the avg rate
  // across the OTHER buckets. Rate = mentions / sessions_in_bucket.
  for (const [bucket, topicMap] of dowMentions) {
    const bucketSessions = dowSessionCount.get(bucket) ?? 0;
    if (bucketSessions === 0) continue;
    for (const [topic, mentions] of topicMap) {
      if (mentions < TEMPORAL_MIN_MENTIONS) continue;
      const bucketRate = mentions / bucketSessions;

      // Baseline: sum mentions and sessions across the OTHER buckets.
      let otherMentions = 0;
      let otherSessions = 0;
      for (const [b, sessions] of dowSessionCount) {
        if (b === bucket) continue;
        otherSessions += sessions;
        otherMentions += dowMentions.get(b)?.get(topic) ?? 0;
      }
      if (otherSessions === 0) continue;
      const baselineRate = otherMentions / otherSessions;
      if (baselineRate === 0) continue; // skip "infinite lift" buckets
      if (bucketRate < baselineRate * TEMPORAL_MIN_LIFT) continue;

      // Convert the baseline rate back into "what mentions would look like
      // at this bucket's session count" so the consumer can compare apples
      // to apples ("4 mentions vs 1 expected").
      out.push({
        dimension: "dow",
        bucket,
        topic,
        mentions,
        baselineMentions: Number(
          (baselineRate * bucketSessions).toFixed(2)
        ),
      });
    }
  }

  // post_rest: only emit when post-rest rate is meaningfully higher.
  for (const [topic, mentions] of postRestMentions) {
    if (mentions < TEMPORAL_MIN_MENTIONS) continue;
    if (postRestSessions === 0 || nonPostRestSessions === 0) continue;
    const postRate = mentions / postRestSessions;
    const otherRate =
      (nonPostRestMentions.get(topic) ?? 0) / nonPostRestSessions;
    if (otherRate === 0) continue;
    if (postRate < otherRate * TEMPORAL_MIN_LIFT) continue;
    out.push({
      dimension: "post_rest",
      bucket: "after rest",
      topic,
      mentions,
      baselineMentions: Number((otherRate * postRestSessions).toFixed(2)),
    });
  }

  // Highest lift first.
  out.sort(
    (a, b) =>
      b.mentions / Math.max(b.baselineMentions, 0.0001) -
      a.mentions / Math.max(a.baselineMentions, 0.0001)
  );
  return out;
}

export async function aggregateTemporalComplaints(
  userId: string
): Promise<NotesTemporalCallout[]> {
  const since = daysAgoIso(TEMPORAL_WINDOW_DAYS);
  const dbRows = await db
    .select({
      scoreId: scoreNotesExtractions.scoreId,
      complaints: scoreNotesExtractions.complaints,
      workoutDate: workoutSessions.workoutDate,
    })
    .from(scoreNotesExtractions)
    .innerJoin(scores, eq(scores.id, scoreNotesExtractions.scoreId))
    .innerJoin(workoutSessions, eq(workoutSessions.id, scores.workoutSessionId))
    .where(
      and(eq(scores.userId, userId), gte(workoutSessions.workoutDate, since))
    );

  const rows: TemporalRow[] = dbRows.map((r) => ({
    scoreId: r.scoreId,
    workoutDate: r.workoutDate,
    topics: Array.from(
      new Set(
        (r.complaints ?? [])
          .filter((c) => c.confidence >= COMPLAINT_MIN_CONFIDENCE)
          .map((c) => c.topic.trim().toLowerCase())
          .filter((t) => t.length > 0)
      )
    ),
  }));
  return aggregateTemporalComplaintsFromRows(rows);
}

// ---------- (b) RPE × complaint correlation ----------

const RPE_MIN_LOGGED_SCORES = 20;
const RPE_TOPIC_MIN_MENTIONS = 3;
const RPE_MIN_LIFT = 3;
const RPE_HIGH_THRESHOLD = 9;

export type NotesRpeCallout = {
  topic: string;
  highRpeMentions: number;
  highRpeScores: number;
  highRpeRate: number; // mentions per high-RPE score
  overallRate: number; // mentions per RPE-logged score
};

export type RpeCorrelationRow = {
  scoreId: string;
  rpe: number; // only RPE-logged scores
  topics: string[]; // distinct, lowercased
};

export function aggregateRpeComplaintCorrelationFromRows(
  rows: RpeCorrelationRow[]
): NotesRpeCallout[] {
  if (rows.length < RPE_MIN_LOGGED_SCORES) return [];

  const highRpeScores = rows.filter((r) => r.rpe >= RPE_HIGH_THRESHOLD);
  if (highRpeScores.length === 0) return [];

  // Per topic: count occurrences in high-RPE scores and across all
  // RPE-logged scores.
  const highCounts = new Map<string, number>();
  const overallCounts = new Map<string, number>();
  for (const row of rows) {
    const uniq = new Set(row.topics);
    for (const topic of uniq) {
      if (!topic) continue;
      overallCounts.set(topic, (overallCounts.get(topic) ?? 0) + 1);
      if (row.rpe >= RPE_HIGH_THRESHOLD) {
        highCounts.set(topic, (highCounts.get(topic) ?? 0) + 1);
      }
    }
  }

  const candidates: NotesRpeCallout[] = [];
  for (const [topic, overall] of overallCounts) {
    if (overall < RPE_TOPIC_MIN_MENTIONS) continue;
    const high = highCounts.get(topic) ?? 0;
    if (high === 0) continue;
    const overallRate = overall / rows.length;
    const highRpeRate = high / highRpeScores.length;
    if (overallRate === 0) continue;
    if (highRpeRate < overallRate * RPE_MIN_LIFT) continue;
    candidates.push({
      topic,
      highRpeMentions: high,
      highRpeScores: highRpeScores.length,
      highRpeRate,
      overallRate,
    });
  }

  // Spec: max one shown. Take the strongest lift.
  candidates.sort(
    (a, b) => b.highRpeRate / b.overallRate - a.highRpeRate / a.overallRate
  );
  return candidates.slice(0, 1);
}

export async function aggregateRpeComplaintCorrelation(
  userId: string
): Promise<NotesRpeCallout[]> {
  // Pull every score (RPE-logged or not) that has an extraction; filter
  // to RPE-logged in-memory. The full set is small per user.
  const dbRows = await db
    .select({
      scoreId: scoreNotesExtractions.scoreId,
      complaints: scoreNotesExtractions.complaints,
      rpe: scores.rpe,
    })
    .from(scoreNotesExtractions)
    .innerJoin(scores, eq(scores.id, scoreNotesExtractions.scoreId))
    .where(and(eq(scores.userId, userId), isNotNull(scores.rpe)));

  const rows: RpeCorrelationRow[] = dbRows
    .filter((r) => r.rpe != null)
    .map((r) => ({
      scoreId: r.scoreId,
      rpe: Number(r.rpe),
      topics: Array.from(
        new Set(
          (r.complaints ?? [])
            .filter((c) => c.confidence >= COMPLAINT_MIN_CONFIDENCE)
            .map((c) => c.topic.trim().toLowerCase())
            .filter((t) => t.length > 0)
        )
      ),
    }));
  return aggregateRpeComplaintCorrelationFromRows(rows);
}

// ---------- (c) Dormant complaints / decay ----------

const DORMANT_RECENT_DAYS = 28;
const DORMANT_HISTORY_DAYS = 90;
const DORMANT_HISTORY_MIN_DAYS = 30; // history window starts at 30 days back
const DORMANT_MIN_PRIOR_MENTIONS = 3;
const DORMANT_MAX_OUTPUT = 2;

export type NotesDormantWin = {
  topic: string;
  priorMentions: number;
  lastMentionedAt: string; // YYYY-MM-DD
};

export type DormantRow = {
  scoreId: string;
  workoutDate: string;
  topics: string[];
};

export function aggregateDormantComplaintsFromRows(
  rows: DormantRow[],
  now: Date = new Date()
): NotesDormantWin[] {
  const recentCutoff = isoFromDate(addDays(now, -DORMANT_RECENT_DAYS));
  const historyStart = isoFromDate(addDays(now, -DORMANT_HISTORY_DAYS));
  const historyEnd = isoFromDate(addDays(now, -DORMANT_HISTORY_MIN_DAYS));

  // Per topic: mentions in the historical window, mentions in the recent
  // window, and the most recent date the topic appeared.
  const priorMentions = new Map<string, number>();
  const recentMentions = new Map<string, number>();
  const lastSeen = new Map<string, string>();

  for (const row of rows) {
    const inRecent = row.workoutDate >= recentCutoff;
    const inHistory =
      row.workoutDate >= historyStart && row.workoutDate <= historyEnd;
    const uniq = new Set(row.topics);
    for (const topic of uniq) {
      if (!topic) continue;
      if (inRecent) {
        recentMentions.set(topic, (recentMentions.get(topic) ?? 0) + 1);
      }
      if (inHistory) {
        priorMentions.set(topic, (priorMentions.get(topic) ?? 0) + 1);
      }
      const prev = lastSeen.get(topic);
      if (!prev || row.workoutDate > prev) lastSeen.set(topic, row.workoutDate);
    }
  }

  const out: NotesDormantWin[] = [];
  for (const [topic, prior] of priorMentions) {
    if (prior < DORMANT_MIN_PRIOR_MENTIONS) continue;
    if ((recentMentions.get(topic) ?? 0) > 0) continue;
    out.push({
      topic,
      priorMentions: prior,
      lastMentionedAt: lastSeen.get(topic) ?? "",
    });
  }

  // Most-recent-prior-mention first so the freshest decays surface.
  out.sort((a, b) => b.lastMentionedAt.localeCompare(a.lastMentionedAt));
  return out.slice(0, DORMANT_MAX_OUTPUT);
}

export async function aggregateDormantComplaints(
  userId: string
): Promise<NotesDormantWin[]> {
  const since = daysAgoIso(DORMANT_HISTORY_DAYS);
  const dbRows = await db
    .select({
      scoreId: scoreNotesExtractions.scoreId,
      complaints: scoreNotesExtractions.complaints,
      workoutDate: workoutSessions.workoutDate,
    })
    .from(scoreNotesExtractions)
    .innerJoin(scores, eq(scores.id, scoreNotesExtractions.scoreId))
    .innerJoin(workoutSessions, eq(workoutSessions.id, scores.workoutSessionId))
    .where(
      and(eq(scores.userId, userId), gte(workoutSessions.workoutDate, since))
    );

  const rows: DormantRow[] = dbRows.map((r) => ({
    scoreId: r.scoreId,
    workoutDate: r.workoutDate,
    topics: Array.from(
      new Set(
        (r.complaints ?? [])
          .filter((c) => c.confidence >= COMPLAINT_MIN_CONFIDENCE)
          .map((c) => c.topic.trim().toLowerCase())
          .filter((t) => t.length > 0)
      )
    ),
  }));
  return aggregateDormantComplaintsFromRows(rows);
}

// ---------- shared date helpers ----------

function parseIsoDate(iso: string): Date | null {
  // workout_date is stored as a bare YYYY-MM-DD; parse against UTC noon to
  // sidestep DST edge cases when computing day-of-week.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function isoFromDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

