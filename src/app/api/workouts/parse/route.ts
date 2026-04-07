import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";

/**
 * POST /api/workouts/parse — parse raw workout text into structured data.
 *
 * This is a stub that performs basic regex-based parsing.
 * A future version could call an LLM for better parsing.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { text } = body;

  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  // Simple heuristic parsing
  const lower = text.toLowerCase();
  let workoutType = "other";
  let timeCapSeconds: number | null = null;
  let amrapDurationSeconds: number | null = null;

  if (lower.includes("for time")) {
    workoutType = "for_time";
    const tcMatch = lower.match(/(\d+)\s*min(?:ute)?\s*(?:time\s*)?cap/);
    if (tcMatch) timeCapSeconds = parseInt(tcMatch[1]) * 60;
  } else if (lower.includes("amrap")) {
    workoutType = "amrap";
    const amrapMatch = lower.match(/amrap\s*(\d+)/);
    if (amrapMatch) amrapDurationSeconds = parseInt(amrapMatch[1]) * 60;
  } else if (lower.includes("emom")) {
    workoutType = "emom";
  } else if (lower.includes("for load") || lower.includes("1rm") || lower.includes("max effort")) {
    workoutType = "for_load";
  } else if (lower.includes("tabata")) {
    workoutType = "tabata";
  }

  // Extract potential movement names (lines that look like "21 <movement>" or "<movement> x 10")
  const lines = text
    .split("\n")
    .map((l: string) => l.trim())
    .filter((l: string) => l.length > 0);

  const movementLines = lines.filter((l: string) => {
    const skip = /^(for time|amrap|emom|tabata|rest|round|min cap|time cap)/i;
    return !skip.test(l);
  });

  return NextResponse.json({
    workoutType,
    timeCapSeconds,
    amrapDurationSeconds,
    rawText: text,
    parsedMovements: movementLines,
    confidence: "low",
    note: "Basic regex parsing. Review and adjust before saving.",
  });
}
