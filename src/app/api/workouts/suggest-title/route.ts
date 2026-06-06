import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import {
  crossfitWorkoutMovements,
  crossfitWorkouts,
  movements,
} from "@/db/schema";
import { eq, inArray, and, isNull } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import {
  WORKOUT_TYPE_LABELS,
  type VestRequirement,
  type WorkoutType,
} from "@/types/crossfit";
import type { WorkoutSectionKind } from "@/db/schema";
import type { TrackKind } from "@/types/programming-tracks";

const TITLE_MODEL = "claude-haiku-4-5";
const HAIKU_TIMEOUT_MS = 2_000;

// ============================================
// Request types
// ============================================

interface SuggestPartInput {
  workoutType: WorkoutType;
  repScheme?: string | null;
  timeCapSeconds?: number | null;
  amrapDurationSeconds?: number | null;
  /** Canonical movement IDs (one entry per workout_movement — duplicates allowed). */
  movementIds: string[];
  /** Fallback free-text names for custom movements that don't have an ID yet. */
  extraMovementNames?: string[];
}

interface SuggestBody {
  parts: SuggestPartInput[];
  // Workout-level signal used for benchmark exact-match comparison.
  // Murph-without-vest should not match canonical Murph; it slides into
  // the (modified) near-match instead. 'optional' is treated as
  // distinct-from-'required' for matching: an optional-vest Murph is still
  // a modification of canonical Murph.
  vestRequirement?: VestRequirement;
  vestWeightMaleLb?: number | null;
  vestWeightFemaleLb?: number | null;
  // Optional authoring context. When provided, biases naming style and
  // gates benchmark matching: pre-/post-skill build-ups and monthly
  // challenges should never get "Grace (modified)" tagged on them.
  context?: {
    sectionKind?: WorkoutSectionKind | null;
    trackKind?: TrackKind | null;
  };
}

// ============================================
// Source of the suggestion
// ============================================

type SuggestionSource = "benchmark" | "benchmark_modified" | "ai" | "fallback";

interface SuggestionResult {
  title: string;
  source: SuggestionSource;
  benchmarkWorkoutId?: string;
}

// ============================================
// Rep scheme normalization
// ============================================

function normalizeRepScheme(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

// ============================================
// Benchmark matching
// ============================================
//
// Strategy: for each *single-part* submission, find benchmarks with:
//   • same workout_type
//   • identical movement multiset (by movement_id)
//   • matching rep_scheme (exact after normalization)
//
// Near-match (benchmark_modified): identical movement multiset and same
// workout_type, but rep scheme / vest scaling differs. We deliberately do
// NOT match on "one movement added or removed" — that produced too many
// false positives ("Fran (modified)" for any thruster workout). Real
// variants like Running Grace live as their own benchmark rows and are
// reached via the exact-match path.

async function findBenchmarkMatch(
  part: SuggestPartInput,
  workoutVest: {
    vestRequirement?: VestRequirement;
    vestWeightMaleLb?: number | null;
    vestWeightFemaleLb?: number | null;
  }
): Promise<{ exact?: { id: string; name: string }; near?: { id: string; name: string } }> {
  if (part.movementIds.length === 0) return {};

  // Unified-schema lookup against `crossfit_workouts` where is_benchmark =
  // true. We skip weightlifting benchmarks — those are auto-generated
  // stat-trackers (one per 1RM-applicable movement) with null repScheme,
  // and any single-movement for_load submission with no part-level
  // repScheme would false-positive against them. The auto-link goes
  // through inferWeightliftingBenchmark separately.
  const candidates = await db
    .select({
      id: crossfitWorkouts.id,
      name: crossfitWorkouts.title,
      workoutType: crossfitWorkouts.workoutType,
      repScheme: crossfitWorkouts.repScheme,
      vestRequirement: crossfitWorkouts.vestRequirement,
      vestWeightMaleLb: crossfitWorkouts.vestWeightMaleLb,
      vestWeightFemaleLb: crossfitWorkouts.vestWeightFemaleLb,
    })
    .from(crossfitWorkouts)
    .where(
      and(
        eq(crossfitWorkouts.workoutType, part.workoutType),
        eq(crossfitWorkouts.isBenchmark, true),
        isNull(crossfitWorkouts.weightliftingMovementId)
      )
    );

  if (candidates.length === 0) return {};

  const candidateIds = candidates.map((c) => c.id);
  const candidateMovementRows = await db
    .select({
      benchmarkWorkoutId: crossfitWorkoutMovements.crossfitWorkoutId,
      movementId: crossfitWorkoutMovements.movementId,
    })
    .from(crossfitWorkoutMovements)
    .where(
      inArray(crossfitWorkoutMovements.crossfitWorkoutId, candidateIds)
    );

  const movementsByBenchmark = new Map<string, string[]>();
  for (const row of candidateMovementRows) {
    const list = movementsByBenchmark.get(row.benchmarkWorkoutId) ?? [];
    list.push(row.movementId);
    movementsByBenchmark.set(row.benchmarkWorkoutId, list);
  }

  const wantMultiset = [...part.movementIds].sort();
  const wantRepScheme = normalizeRepScheme(part.repScheme);
  const wantVest = (workoutVest.vestRequirement ?? "none") as VestRequirement;
  const wantVestM =
    workoutVest.vestWeightMaleLb != null
      ? Number(workoutVest.vestWeightMaleLb)
      : null;
  const wantVestF =
    workoutVest.vestWeightFemaleLb != null
      ? Number(workoutVest.vestWeightFemaleLb)
      : null;

  let exact: { id: string; name: string } | undefined;
  let near: { id: string; name: string } | undefined;

  for (const bw of candidates) {
    const bwMovements = (movementsByBenchmark.get(bw.id) ?? []).slice().sort();
    const sameMultiset =
      bwMovements.length === wantMultiset.length &&
      bwMovements.every((id, i) => id === wantMultiset[i]);

    if (sameMultiset) {
      const bwRepScheme = normalizeRepScheme(bw.repScheme);
      const bwVestM =
        bw.vestWeightMaleLb != null ? Number(bw.vestWeightMaleLb) : null;
      const bwVestF =
        bw.vestWeightFemaleLb != null ? Number(bw.vestWeightFemaleLb) : null;
      const vestMatches =
        (bw.vestRequirement as VestRequirement) === wantVest &&
        bwVestM === wantVestM &&
        bwVestF === wantVestF;
      if (bwRepScheme === wantRepScheme && vestMatches) {
        exact = { id: bw.id, name: bw.name };
        break;
      }
    }

    // Near-match: identical multiset + same workout_type, but rep scheme
    // or vest scaling differs. We do NOT widen this to allow ±1 movement
    // — that produced false positives like "Fran (modified)" for any
    // thruster-based workout.
    if (!near && sameMultiset) {
      near = { id: bw.id, name: bw.name };
    }
  }

  return { exact, near };
}

// ============================================
// Workout description (Haiku input)
// ============================================

function formatMinSec(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** "20 min" for whole minutes, "12:30" otherwise. */
function formatDuration(totalSeconds: number): string {
  return totalSeconds % 60 === 0
    ? `${totalSeconds / 60} min`
    : formatMinSec(totalSeconds);
}

/**
 * Human label for the section/track context so Haiku can pick the right
 * naming mode. Keep these phrasings stable — they match the labels used
 * in the prompt's CONTEXT-AWARENESS section.
 */
function contextLabel(
  ctx: SuggestBody["context"] | undefined
): string | null {
  if (!ctx) return null;
  // Section kind wins over track kind when both are present (the section
  // is the more specific signal — a monthly challenge surfaced as a
  // post_skill section is still "post_skill" for naming purposes).
  if (ctx.sectionKind) {
    switch (ctx.sectionKind) {
      case "wod":
        return "WOD";
      case "pre_skill":
        return "Pre-skill";
      case "post_skill":
        return "Post-skill";
      case "warm_up":
        return "Warm-up";
      case "stretching":
        return "Stretching";
      case "monthly_challenge":
        return "Monthly challenge";
      case "at_home":
        return "At-home workout";
      case "custom":
        return null; // Fall through to track kind if set.
      default:
        return null;
    }
  }
  if (ctx.trackKind) {
    switch (ctx.trackKind) {
      case "monthly_challenge":
        return "Monthly challenge";
      case "cap":
        return "CAP track";
      case "event_prep":
        return "Event prep track";
      case "custom":
        return "Custom track";
      default:
        return null;
    }
  }
  return null;
}

/**
 * Render the workout spec as a short, human-readable description.
 * Haiku names workouts far more reliably from prose than from a raw JSON
 * blob — it shouldn't have to guess what `timeCapSeconds` means.
 */
function describeWorkoutForHaiku(
  parts: SuggestPartInput[],
  movementNameById: Map<string, string>,
  context: SuggestBody["context"] | undefined
): string {
  const describePart = (p: SuggestPartInput): string => {
    const typeLabel = WORKOUT_TYPE_LABELS[p.workoutType] ?? "Workout";

    // Structure clause — fold in the duration / time cap when we have one.
    let structure = typeLabel;
    if (p.workoutType === "amrap" && p.amrapDurationSeconds) {
      structure = `AMRAP ${formatDuration(p.amrapDurationSeconds)}`;
    } else if (p.timeCapSeconds) {
      structure = `${typeLabel} (${formatMinSec(p.timeCapSeconds)} cap)`;
    }
    if (p.repScheme && p.repScheme.trim()) {
      structure += `, rep scheme ${p.repScheme.trim()}`;
    }

    const names = [
      ...p.movementIds
        .map((id) => movementNameById.get(id))
        .filter((n): n is string => !!n),
      ...(p.extraMovementNames ?? []),
    ];
    return names.length
      ? `${structure} — Movements: ${names.join(", ")}`
      : structure;
  };

  const ctxLine = contextLabel(context);
  const prefix = ctxLine ? `Context: ${ctxLine}\n` : "";

  if (parts.length === 1) {
    return `${prefix}Workout: ${describePart(parts[0])}`;
  }
  const lines = parts.map((p, i) => `Part ${i + 1}: ${describePart(p)}`);
  return `${prefix}Workout with ${parts.length} parts.\n${lines.join("\n")}`;
}

/**
 * Benchmark matching only makes sense for sections / tracks where the
 * athlete might actually be doing a benchmark or a close variant. A
 * pre-skill back-squat ramp should never get "Grace (modified)" stamped
 * on it, even if its movement multiset happens to match one.
 *
 * Returns true when the context is missing, "wod", "custom", or a
 * non-monthly_challenge track — i.e. anywhere a benchmark is plausible.
 */
function contextAllowsBenchmarkMatch(
  ctx: SuggestBody["context"] | undefined
): boolean {
  if (!ctx) return true;
  if (ctx.sectionKind) {
    switch (ctx.sectionKind) {
      case "wod":
      case "custom":
        // "custom" sections might be a coach naming an unusual WOD —
        // still allow benchmark matching here.
        break;
      case "pre_skill":
      case "post_skill":
      case "warm_up":
      case "stretching":
      case "monthly_challenge":
      case "at_home":
        return false;
    }
  }
  if (ctx.trackKind === "monthly_challenge") return false;
  return true;
}

// ============================================
// Haiku fallback
// ============================================

const HAIKU_SYSTEM_PROMPT = `You name CrossFit prescriptions. Given a workout's structure, movements, and authoring context, return one short, memorable title that fits the *purpose* of the piece, not just its movements.

CONTEXT-AWARENESS (most important)
The prompt may include a "Context:" line describing where this prescription lives. Tailor the name to that purpose:

- Context: WOD (or no Context line) — punchy CrossFit-style WOD names. Movement-evocative or structure-evocative is good ("Thruster Hell", "Down the Ladder", "Grip & Rip"). Treat this like naming a benchmark.

- Context: Pre-skill — this is a build-up, warm-up to weight, ramp, or movement primer that comes BEFORE the WOD. Lean into that purpose. Good names: "Squat Build-Up", "Snatch Ramp", "Heavy Single Build", "Clean Pull Wave", "Pre-Skill Primer", "Find a Heavy 3". Avoid making it sound like a WOD (no "Hell", "Carnage", "Suffer").

- Context: Post-skill — this is a finisher, burnout, accessory, or short conditioning piece AFTER the WOD. Lean into the finisher vibe. Good names: "Post-Skill Burnout", "Bell Ringer", "Lung Tax", "Core Crusher", "Grip Finisher", "Last Call", "Snatch Burnout".

- Context: Warm-up — light, mobilization-flavored. Good names: "Dynamic Open", "Movement Primer", "Warm the Engine".

- Context: Monthly challenge — this is one day in a long-running challenge (e.g., daily burpees for 30 days). Lean into streak / daily / ladder vibes. Good names: "Daily Burpee Climb", "Sit-Up Streak", "Burpee Ladder Day", "30-Day Tax".

- Context: Custom track / CAP track / Event prep track — treat like a WOD, but slightly more programmed-feeling. WOD-style names are fine.

STYLE
- 1–5 words, Title Case.
- The name should hint at what the athlete is in for — the purpose (build-up, finisher), a signature movement, the structure (AMRAP, ladder, EMOM), or the rep scheme.
- Nod to iconic rep schemes when present (21-15-9 → "Down the Ladder", "Triple Down").

RULES
- No punctuation except apostrophes and ampersands. No quotes, no emojis.
- No numbers unless they come straight from the workout (a rep scheme like 21-15-9 is fine; "30-Day" is fine for monthly challenges).
- Never invent weights, rep counts, or movements the user didn't provide.
- Never reuse the name of a real benchmark WOD (Fran, Murph, Cindy, Grace, Diane, Helen, Karen, Annie, Jackie, etc.) — those are reserved, even with a suffix.
- Avoid the literal word "WOD" or "Workout", and generic filler ("My Workout", "Today's Session", "Daily Grind").

EXAMPLES
Context: WOD
Workout: For Time, rep scheme 21-15-9 — Movements: Deadlift, Box Jump Over
Title: Down the Ladder

Context: WOD
Workout: AMRAP 20 min — Movements: Wall Ball, Toes-to-Bar, Burpee
Title: Wall Ball Wasteland

Context: Pre-skill
Workout: For Load — Movements: Back Squat
Title: Back Squat Build-Up

Context: Pre-skill
Workout: For Load, rep scheme 5-3-1 — Movements: Power Snatch
Title: Snatch Ramp to Heavy

Context: Post-skill
Workout: AMRAP 6 min — Movements: Dumbbell Snatch, Burpee
Title: Snatch & Burpee Burnout

Context: Post-skill
Workout: For Time (5:00 cap) — Movements: Toes-to-Bar, Push-Up
Title: Core Bell Ringer

Context: Monthly challenge
Workout: For Reps — Movements: Burpee
Title: Daily Burpee Climb

Context: WOD
Workout with 2 parts.
Part 1: For Load — Movements: Back Squat
Part 2: For Time (10:00 cap) — Movements: Pull-Up, Push-Up, Air Squat
Title: Squat Then Sprint

Output only the title — no explanation, no quotes, no prefix.`;

async function callHaiku(prompt: string): Promise<string | null> {
  try {
    const client = new Anthropic({ maxRetries: 0 });
    const response = await client.messages.create(
      {
        model: TITLE_MODEL,
        max_tokens: 50,
        system: [
          {
            type: "text",
            text: HAIKU_SYSTEM_PROMPT,
            // No-op until the system prompt clears Haiku's ~2k-token cache
            // minimum, but harmless and future-proof if the prompt grows.
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: prompt }],
      },
      { timeout: HAIKU_TIMEOUT_MS }
    );

    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return null;

    const cleaned = block.text
      .trim()
      .split("\n")[0]
      .replace(/^title:\s*/i, "")
      .replace(/^["“”']+|["“”']+$/g, "")
      .replace(/[.]+$/, "")
      .trim();

    if (!cleaned || cleaned.length > 60) return null;
    return cleaned;
  } catch (err) {
    console.warn("[suggest-title] Haiku call failed:", err);
    return null;
  }
}

// ============================================
// Deterministic fallback (matches legacy behavior)
// ============================================

function deterministicTitle(
  parts: SuggestPartInput[],
  movementNameById: Map<string, string>
): string {
  const typeLabel = WORKOUT_TYPE_LABELS[parts[0].workoutType] ?? "Workout";

  const names = parts.flatMap((p) => [
    ...p.movementIds
      .map((id) => movementNameById.get(id))
      .filter((n): n is string => !!n),
    ...(p.extraMovementNames ?? []),
  ]);

  const firstTwo = Array.from(new Set(names)).slice(0, 2).join(", ");
  return firstTwo ? `${typeLabel} — ${firstTwo}` : typeLabel;
}

// ============================================
// Handler
// ============================================

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: SuggestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parts = Array.isArray(body?.parts) ? body.parts : [];
  if (parts.length === 0) {
    return NextResponse.json({ error: "At least one part is required" }, { status: 400 });
  }

  // 1. Exact benchmark match (only meaningful for single-part workouts,
  //    and only for contexts where calling something a benchmark variant
  //    actually helps the coach — see contextAllowsBenchmarkMatch).
  if (parts.length === 1 && contextAllowsBenchmarkMatch(body.context)) {
    const { exact, near } = await findBenchmarkMatch(parts[0], {
      vestRequirement: body.vestRequirement,
      vestWeightMaleLb: body.vestWeightMaleLb,
      vestWeightFemaleLb: body.vestWeightFemaleLb,
    });
    if (exact) {
      const result: SuggestionResult = {
        title: exact.name,
        source: "benchmark",
        benchmarkWorkoutId: exact.id,
      };
      return NextResponse.json(result);
    }
    if (near) {
      const result: SuggestionResult = {
        title: `${near.name} (modified)`,
        source: "benchmark_modified",
      };
      return NextResponse.json(result);
    }
  }

  // 2. Haiku suggestion. Resolve canonical movement names up front so both
  //    the Haiku prompt and the deterministic fallback can use them (IDs
  //    alone are useless to the model).
  const allMovementIds = Array.from(
    new Set(parts.flatMap((p) => p.movementIds))
  );
  const movementNameById = new Map<string, string>();
  if (allMovementIds.length > 0) {
    const rows = await db
      .select({ id: movements.id, canonicalName: movements.canonicalName })
      .from(movements)
      .where(inArray(movements.id, allMovementIds));
    for (const r of rows) movementNameById.set(r.id, r.canonicalName);
  }

  const haikuTitle = await callHaiku(
    describeWorkoutForHaiku(parts, movementNameById, body.context)
  );
  if (haikuTitle) {
    const result: SuggestionResult = { title: haikuTitle, source: "ai" };
    return NextResponse.json(result);
  }

  // 3. Deterministic fallback.
  const fallback = deterministicTitle(parts, movementNameById);
  const result: SuggestionResult = { title: fallback, source: "fallback" };
  return NextResponse.json(result);
}
