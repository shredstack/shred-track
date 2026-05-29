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
import { WORKOUT_TYPE_LABELS, type WorkoutType } from "@/types/crossfit";

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
  // the (modified) near-match instead.
  requiresVest?: boolean;
  vestWeightMaleLb?: number | null;
  vestWeightFemaleLb?: number | null;
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
// Near-match (benchmark_modified): same type, movement multiset differs by
// at most one movement (one added or one removed). Only ever suggested for
// single-part submissions.

async function findBenchmarkMatch(
  part: SuggestPartInput,
  workoutVest: {
    requiresVest?: boolean;
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
      requiresVest: crossfitWorkouts.requiresVest,
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
  const wantVest = !!workoutVest.requiresVest;
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
        !!bw.requiresVest === wantVest &&
        bwVestM === wantVestM &&
        bwVestF === wantVestF;
      if (bwRepScheme === wantRepScheme && vestMatches) {
        exact = { id: bw.id, name: bw.name };
        break;
      }
    }

    if (!near) {
      const diff = multisetSymmetricDiff(bwMovements, wantMultiset);
      if (diff <= 1) near = { id: bw.id, name: bw.name };
    }
  }

  return { exact, near };
}

function multisetSymmetricDiff(a: string[], b: string[]): number {
  const counts = new Map<string, number>();
  for (const id of a) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const id of b) counts.set(id, (counts.get(id) ?? 0) - 1);
  let diff = 0;
  for (const v of counts.values()) diff += Math.abs(v);
  return diff;
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
 * Render the workout spec as a short, human-readable description.
 * Haiku names workouts far more reliably from prose than from a raw JSON
 * blob — it shouldn't have to guess what `timeCapSeconds` means.
 */
function describeWorkoutForHaiku(
  parts: SuggestPartInput[],
  movementNameById: Map<string, string>
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

  if (parts.length === 1) {
    return `Workout: ${describePart(parts[0])}`;
  }
  const lines = parts.map((p, i) => `Part ${i + 1}: ${describePart(p)}`);
  return `Workout with ${parts.length} parts.\n${lines.join("\n")}`;
}

// ============================================
// Haiku fallback
// ============================================

const HAIKU_SYSTEM_PROMPT = `You name CrossFit workouts (WODs). Given a workout's structure and movements, return one short, memorable title.

STYLE
- 1–5 words, Title Case.
- Fun and a little punchy, but grounded: the name should hint at what the athlete is in for — a signature movement, the structure (AMRAP, ladder, EMOM), or the rep scheme.
- Lean into CrossFit naming culture. Nod to iconic rep schemes (21-15-9 or any descending ladder → "Down the Ladder", "Triple Down"). The short, snappy, evocative style of benchmark "Girl" WODs is fair game.
- Movement-evocative ("Thruster Hell", "Deadlift Ladder") or vibe names ("Grip & Rip", "Light 'Till It's Not") both work.

RULES
- No punctuation except apostrophes and ampersands. No quotes, no emojis.
- No numbers unless they come straight from the workout (a rep scheme like 21-15-9 is fine).
- Never invent weights, rep counts, or movements the user didn't provide.
- Never reuse the name of a real benchmark WOD (Fran, Murph, Cindy, Grace, Diane, Helen, etc.) — those are reserved.
- Avoid the literal word "WOD" or "Workout", and generic filler ("My Workout", "Today's Session", "Daily Grind").

EXAMPLES
Workout: For Time, rep scheme 21-15-9 — Movements: Deadlift, Box Jump Over
Title: Down the Ladder

Workout: AMRAP 20 min — Movements: Wall Ball, Toes-to-Bar, Burpee
Title: Wall Ball Wasteland

Workout: EMOM — Movements: Power Clean, Burpee
Title: Clean & Suffer

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

  // 1. Exact benchmark match (only meaningful for single-part workouts).
  if (parts.length === 1) {
    const { exact, near } = await findBenchmarkMatch(parts[0], {
      requiresVest: body.requiresVest,
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
    describeWorkoutForHaiku(parts, movementNameById)
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
