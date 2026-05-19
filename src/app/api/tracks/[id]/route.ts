// GET /api/tracks/[id] — track detail + today's day + participation status
// Members of the gym only.

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  programmingTrackDays,
  programmingTrackParticipations,
  programmingTracks,
  communities,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canViewGym } from "@/lib/authz/community";

function todayInTz(tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const [track] = await db
    .select()
    .from(programmingTracks)
    .where(eq(programmingTracks.id, id))
    .limit(1);
  if (!track) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canViewGym(user.id, track.communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const [gym] = await db
    .select({ tz: communities.gymTimezone })
    .from(communities)
    .where(eq(communities.id, track.communityId))
    .limit(1);
  const today = todayInTz(gym?.tz ?? "America/Denver");
  const days = await db
    .select()
    .from(programmingTrackDays)
    .where(eq(programmingTrackDays.trackId, id))
    .orderBy(asc(programmingTrackDays.date));
  const [participation] = await db
    .select()
    .from(programmingTrackParticipations)
    .where(
      and(
        eq(programmingTrackParticipations.trackId, id),
        eq(programmingTrackParticipations.userId, user.id),
        isNull(programmingTrackParticipations.leftAt)
      )
    )
    .limit(1);
  const todaysDay = days.find((d) => d.date === today) ?? null;
  return NextResponse.json({
    track,
    days,
    today,
    todaysDay,
    joined: !!participation,
  });
}
