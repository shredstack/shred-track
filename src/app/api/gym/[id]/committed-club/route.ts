// GET /api/gym/[id]/committed-club?yearMonth=YYYY-MM
//
// Returns the leaderboard for the given month. Defaults to current
// month (gym-local). Members only.

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { communities } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canViewGym } from "@/lib/authz/community";
import { getMonthlyLeaderboard, gymMonthBounds } from "@/lib/committed-club";
import { resolveGymTimezone } from "@/lib/timezone";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId } = await params;
  if (!(await canViewGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  let yearMonth = url.searchParams.get("yearMonth") ?? "";
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    const [c] = await db
      .select({ tz: communities.gymTimezone })
      .from(communities)
      .where(eq(communities.id, communityId))
      .limit(1);
    yearMonth = gymMonthBounds(resolveGymTimezone(c?.tz)).yearMonth;
  }
  const rows = await getMonthlyLeaderboard(communityId, yearMonth, 100);
  return NextResponse.json({ yearMonth, rows });
}
