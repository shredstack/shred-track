import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db } from "@/db";
import { hyroxProfiles, hyroxPracticeRaces } from "@/db/schema";
import { and, eq } from "drizzle-orm";

interface SyncPayload {
  raceId: string;
  /** Update bestFinishTimeSeconds if this is a PR. */
  applyFinishPR?: boolean;
  /** Increment previousRaceCount (only meaningful when raceType = 'actual'). */
  incrementRaceCount?: boolean;
  /** When applying a PR, also write bestDivision from the race. */
  applyDivision?: boolean;
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: SyncPayload;
  try {
    body = (await request.json()) as SyncPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.raceId) {
    return NextResponse.json({ error: "raceId is required" }, { status: 400 });
  }

  const [race] = await db
    .select()
    .from(hyroxPracticeRaces)
    .where(
      and(
        eq(hyroxPracticeRaces.id, body.raceId),
        eq(hyroxPracticeRaces.userId, user.id),
      ),
    )
    .limit(1);

  if (!race) {
    return NextResponse.json({ error: "Race not found" }, { status: 404 });
  }

  const [profile] = await db
    .select()
    .from(hyroxProfiles)
    .where(eq(hyroxProfiles.userId, user.id))
    .limit(1);

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const totalTimeRounded = Math.round(parseFloat(race.totalTimeSeconds));

  const updates: {
    bestFinishTimeSeconds?: number;
    bestDivision?: string | null;
    previousRaceCount?: number;
    updatedAt?: Date;
  } = {};

  if (body.applyFinishPR) {
    const isPR =
      profile.bestFinishTimeSeconds == null ||
      totalTimeRounded < profile.bestFinishTimeSeconds;
    if (isPR) {
      updates.bestFinishTimeSeconds = totalTimeRounded;
      if (body.applyDivision && race.divisionKey) {
        updates.bestDivision = race.divisionKey;
      }
    }
  }

  if (body.incrementRaceCount && race.raceType === "actual") {
    updates.previousRaceCount = (profile.previousRaceCount ?? 0) + 1;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true, applied: false });
  }

  updates.updatedAt = new Date();

  const [updated] = await db
    .update(hyroxProfiles)
    .set(updates)
    .where(eq(hyroxProfiles.userId, user.id))
    .returning();

  return NextResponse.json({ ok: true, applied: true, profile: updated });
}
