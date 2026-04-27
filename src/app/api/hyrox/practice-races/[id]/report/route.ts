import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db } from "@/db";
import { hyroxPracticeRaces, hyroxRaceReports } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { inngest } from "@/inngest/client";

// ---------------------------------------------------------------------------
// GET — fetch the AI race report for a race.
//   404 → no row at all (user hasn't requested generation yet)
//   202 → row exists but status is pending/generating (UI polls)
//   200 → completed or failed (UI renders accordingly)
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

  // Verify ownership of the race.
  const [race] = await db
    .select({ id: hyroxPracticeRaces.id })
    .from(hyroxPracticeRaces)
    .where(
      and(
        eq(hyroxPracticeRaces.id, id),
        eq(hyroxPracticeRaces.userId, user.id),
      ),
    )
    .limit(1);

  if (!race) {
    return NextResponse.json({ error: "Race not found" }, { status: 404 });
  }

  const [report] = await db
    .select()
    .from(hyroxRaceReports)
    .where(eq(hyroxRaceReports.raceId, id))
    .limit(1);

  if (!report) {
    return NextResponse.json({ error: "No report" }, { status: 404 });
  }

  if (report.status === "pending" || report.status === "generating") {
    return NextResponse.json(report, { status: 202 });
  }

  return NextResponse.json(report);
}

// ---------------------------------------------------------------------------
// POST — request (or re-request) generation. Idempotent for active states.
// ---------------------------------------------------------------------------

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify ownership.
  const [race] = await db
    .select()
    .from(hyroxPracticeRaces)
    .where(
      and(
        eq(hyroxPracticeRaces.id, id),
        eq(hyroxPracticeRaces.userId, user.id),
      ),
    )
    .limit(1);

  if (!race) {
    return NextResponse.json({ error: "Race not found" }, { status: 404 });
  }

  // Upsert a pending report row.
  const [existing] = await db
    .select()
    .from(hyroxRaceReports)
    .where(eq(hyroxRaceReports.raceId, id))
    .limit(1);

  let report;
  if (!existing) {
    [report] = await db
      .insert(hyroxRaceReports)
      .values({
        raceId: id,
        userId: user.id,
        status: "pending",
      })
      .returning();
  } else {
    [report] = await db
      .update(hyroxRaceReports)
      .set({
        status: "pending",
        generationError: null,
        generationStartedAt: null,
        generationCompletedAt: null,
      })
      .where(eq(hyroxRaceReports.raceId, id))
      .returning();
  }

  // Fire the generation event.
  await inngest.send({
    name: "hyrox/race.completed",
    data: {
      raceId: id,
      userId: user.id,
    },
  });

  return NextResponse.json(report);
}
