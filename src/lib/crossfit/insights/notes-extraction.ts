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
  scoreNotesExtractions,
  users,
  workoutSessions,
} from "@/db/schema";
import { and, desc, eq, gte, inArray, isNotNull, or, sql } from "drizzle-orm";
import type {
  NotesComplaint,
  NotesExtraction,
  NotesMilestone,
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
export const NOTES_MODEL_VERSION = "claude-sonnet-4-6.v5";

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
    { "topic": string, "phrase": string, "confidence": number }
  ],
  "scalingRationale": [
    { "movement": string | null, "reason": string, "phrase": string }
  ],
  "milestones": [
    { "type": "first" | "pr" | "win", "phrase": string }
  ]
}

Definitions:
- complaints: Body parts, injuries, fatigue, lost capacity, or repeated discomfort. \`topic\` is a short canonical noun ("shoulder", "low back", "grip", "hip", "arm strength", "endurance", "shoulder strength"). Capture lost-strength, "felt weak", or "harder than expected" mentions when the athlete frames them as a problem. \`phrase\` is the verbatim snippet. \`confidence\` is 0..1 — 1.0 if explicit, 0.6–0.8 for clear-but-implicit, 0.4 for vague.
- scalingRationale: Reasons that explain why the athlete scaled (used a lighter weight, easier variant, fewer reps, banded version, etc.). Cross-reference the workout context to attribute correctly:
  - For a Movement note, ALWAYS use the prefixed movement name.
  - For a Score note that refers to multiple movements ("the other two DB movements"), emit ONE entry per movement the athlete is referring to, using the workout-context movement names.
  - When the athlete describes a difficulty without explicitly mentioning scaling, but the workout context shows they DID scale that movement, you may still infer the rationale.
  - \`reason\` is a short canonical phrase ("grip", "shoulder pain", "skill", "intensity", "strength", "endurance").
  - If you can't tie a difficulty to a specific scaled movement and no movement is explicitly named, set \`movement\` to null.
- milestones: First-time achievements ("first time", "PR", "linked unbroken"), wins, or breakthroughs. \`type\` is "first" for firsts, "pr" for PRs, "win" otherwise.

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
      extraction: { complaints: [], scalingRationale: [], milestones: [] },
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
    return { complaints: [], scalingRationale: [], milestones: [] };
  }

  if (!parsed || typeof parsed !== "object") {
    return { complaints: [], scalingRationale: [], milestones: [] };
  }

  const obj = parsed as Record<string, unknown>;
  return {
    complaints: coerceComplaints(obj.complaints),
    scalingRationale: coerceScalingReasons(obj.scalingRationale),
    milestones: coerceMilestones(obj.milestones),
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
    out.push({
      topic: r.topic.trim().toLowerCase(),
      phrase: r.phrase.trim(),
      confidence: Math.max(0, Math.min(1, conf)),
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
// older model_version or content_hash.
export async function saveExtraction(
  scoreId: string,
  extraction: NotesExtraction,
  modelVersion: string,
  contentHash: string
): Promise<void> {
  await db
    .insert(scoreNotesExtractions)
    .values({
      scoreId,
      complaints: extraction.complaints,
      scalingRationale: extraction.scalingRationale,
      milestones: extraction.milestones,
      modelVersion,
      contentHash,
      extractedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: scoreNotesExtractions.scoreId,
      set: {
        complaints: extraction.complaints,
        scalingRationale: extraction.scalingRationale,
        milestones: extraction.milestones,
        modelVersion,
        contentHash,
        extractedAt: new Date(),
      },
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

