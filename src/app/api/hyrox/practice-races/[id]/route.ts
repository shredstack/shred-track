import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db } from "@/db";
import { hyroxPracticeRaces, hyroxPracticeRaceSplits } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";

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
