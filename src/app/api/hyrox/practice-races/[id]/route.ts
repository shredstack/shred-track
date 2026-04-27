import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db } from "@/db";
import { hyroxPracticeRaces, hyroxPracticeRaceSplits } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";

// ---------------------------------------------------------------------------
// GET — race + splits
// ---------------------------------------------------------------------------

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const [race] = await db
    .select()
    .from(hyroxPracticeRaces)
    .where(
      and(eq(hyroxPracticeRaces.id, id), eq(hyroxPracticeRaces.userId, user.id)),
    );

  if (!race) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const splits = await db
    .select()
    .from(hyroxPracticeRaceSplits)
    .where(eq(hyroxPracticeRaceSplits.raceId, id))
    .orderBy(asc(hyroxPracticeRaceSplits.segmentOrder));

  return NextResponse.json({ ...race, splits });
}

// ---------------------------------------------------------------------------
// PATCH — edit title, notes, raceType only.
// Splits and totals are intentionally immutable.
// ---------------------------------------------------------------------------

const ALLOWED_PATCH_KEYS = new Set(["title", "notes", "raceType"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Reject unknown keys explicitly.
  for (const key of Object.keys(body)) {
    if (!ALLOWED_PATCH_KEYS.has(key)) {
      return NextResponse.json(
        { error: `Field '${key}' cannot be edited` },
        { status: 400 },
      );
    }
  }

  const updates: { title?: string; notes?: string | null; raceType?: string } = {};

  if ("title" in body) {
    if (typeof body.title !== "string") {
      return NextResponse.json({ error: "title must be a string" }, { status: 400 });
    }
    const trimmed = body.title.trim();
    if (trimmed.length < 1 || trimmed.length > 120) {
      return NextResponse.json(
        { error: "title must be 1–120 characters" },
        { status: 400 },
      );
    }
    updates.title = trimmed;
  }

  if ("notes" in body) {
    if (body.notes !== null && typeof body.notes !== "string") {
      return NextResponse.json({ error: "notes must be a string or null" }, { status: 400 });
    }
    const value = body.notes ?? "";
    if (value.length > 2000) {
      return NextResponse.json(
        { error: "notes must be 2000 characters or fewer" },
        { status: 400 },
      );
    }
    updates.notes = value === "" ? null : value;
  }

  if ("raceType" in body) {
    if (body.raceType !== "practice" && body.raceType !== "actual") {
      return NextResponse.json(
        { error: "raceType must be 'practice' or 'actual'" },
        { status: 400 },
      );
    }
    updates.raceType = body.raceType;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }

  const [race] = await db
    .update(hyroxPracticeRaces)
    .set(updates)
    .where(
      and(eq(hyroxPracticeRaces.id, id), eq(hyroxPracticeRaces.userId, user.id)),
    )
    .returning();

  if (!race) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(race);
}

// ---------------------------------------------------------------------------
// DELETE — race (splits cascade; benchmarks keep history via SET NULL).
// ---------------------------------------------------------------------------

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const deleted = await db
    .delete(hyroxPracticeRaces)
    .where(
      and(eq(hyroxPracticeRaces.id, id), eq(hyroxPracticeRaces.userId, user.id)),
    )
    .returning({ id: hyroxPracticeRaces.id });

  if (deleted.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
