import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import {
  benchmarkWorkouts,
  benchmarkWorkoutMovements,
  movements,
} from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
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
  part: SuggestPartInput
): Promise<{ exact?: { id: string; name: string }; near?: { id: string; name: string } }> {
  if (part.movementIds.length === 0) return {};

  const candidates = await db
    .select()
    .from(benchmarkWorkouts)
    .where(eq(benchmarkWorkouts.workoutType, part.workoutType));

  if (candidates.length === 0) return {};

  const candidateIds = candidates.map((c) => c.id);
  const candidateMovementRows = await db
    .select({
      benchmarkWorkoutId: benchmarkWorkoutMovements.benchmarkWorkoutId,
      movementId: benchmarkWorkoutMovements.movementId,
    })
    .from(benchmarkWorkoutMovements)
    .where(inArray(benchmarkWorkoutMovements.benchmarkWorkoutId, candidateIds));

  const movementsByBenchmark = new Map<string, string[]>();
  for (const row of candidateMovementRows) {
    const list = movementsByBenchmark.get(row.benchmarkWorkoutId) ?? [];
    list.push(row.movementId);
    movementsByBenchmark.set(row.benchmarkWorkoutId, list);
  }

  const wantMultiset = [...part.movementIds].sort();
  const wantRepScheme = normalizeRepScheme(part.repScheme);

  let exact: { id: string; name: string } | undefined;
  let near: { id: string; name: string } | undefined;

  for (const bw of candidates) {
    const bwMovements = (movementsByBenchmark.get(bw.id) ?? []).slice().sort();
    const sameMultiset =
      bwMovements.length === wantMultiset.length &&
      bwMovements.every((id, i) => id === wantMultiset[i]);

    if (sameMultiset) {
      const bwRepScheme = normalizeRepScheme(bw.repScheme);
      if (bwRepScheme === wantRepScheme) {
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
// Haiku fallback
// ============================================

const HAIKU_SYSTEM_PROMPT = `You name CrossFit workouts. Output a single title — 1–5 words, no punctuation except apostrophes, no quotes, no emojis. Lean fun and descriptive. Prefer movement-evocative names ("Thruster Hell", "Deadlift Ladder") or vibe names ("Light 'Till It's Not", "Grip & Rip"). Avoid: "WOD", the word "workout", generic filler ("My Workout", "Today's Session"). Never invent weights or rep numbers the user didn't provide.

Output only the title. No explanation, no prefix.`;

async function callHaiku(spec: object): Promise<string | null> {
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
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: JSON.stringify(spec) }],
      },
      { timeout: HAIKU_TIMEOUT_MS }
    );

    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return null;

    const cleaned = block.text
      .trim()
      .replace(/^["“”']+|["“”']+$/g, "")
      .replace(/^title:\s*/i, "")
      .split("\n")[0]
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

async function deterministicTitle(parts: SuggestPartInput[]): Promise<string> {
  const firstPart = parts[0];
  const typeLabel = WORKOUT_TYPE_LABELS[firstPart.workoutType] ?? "Workout";

  const allMovementIds = parts.flatMap((p) => p.movementIds);
  const extraNames = parts.flatMap((p) => p.extraMovementNames ?? []);

  let names: string[] = [];
  if (allMovementIds.length > 0) {
    const rows = await db
      .select({ id: movements.id, canonicalName: movements.canonicalName })
      .from(movements)
      .where(inArray(movements.id, Array.from(new Set(allMovementIds))));
    const byId = new Map(rows.map((r) => [r.id, r.canonicalName]));
    names = allMovementIds.map((id) => byId.get(id)).filter((n): n is string => !!n);
  }
  names = [...names, ...extraNames];

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
    const { exact, near } = await findBenchmarkMatch(parts[0]);
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

  // 2. Haiku suggestion.
  const haikuSpec = {
    parts: parts.map((p) => ({
      workoutType: p.workoutType,
      repScheme: p.repScheme ?? null,
      timeCapSeconds: p.timeCapSeconds ?? null,
      amrapDurationSeconds: p.amrapDurationSeconds ?? null,
      movementCount: p.movementIds.length,
      extraMovementNames: p.extraMovementNames ?? [],
    })),
  };

  // Resolve canonical movement names for the Haiku prompt so it has something
  // concrete to riff on (IDs alone are useless to the model).
  const allMovementIds = Array.from(
    new Set(parts.flatMap((p) => p.movementIds))
  );
  if (allMovementIds.length > 0) {
    const rows = await db
      .select({ id: movements.id, canonicalName: movements.canonicalName })
      .from(movements)
      .where(inArray(movements.id, allMovementIds));
    const byId = new Map(rows.map((r) => [r.id, r.canonicalName]));
    (haikuSpec as unknown as { movementNames: string[] }).movementNames = parts.flatMap((p) =>
      [...p.movementIds.map((id) => byId.get(id)).filter((n): n is string => !!n), ...(p.extraMovementNames ?? [])]
    );
  }

  const haikuTitle = await callHaiku(haikuSpec);
  if (haikuTitle) {
    const result: SuggestionResult = { title: haikuTitle, source: "ai" };
    return NextResponse.json(result);
  }

  // 3. Deterministic fallback.
  const fallback = await deterministicTitle(parts);
  const result: SuggestionResult = { title: fallback, source: "fallback" };
  return NextResponse.json(result);
}
