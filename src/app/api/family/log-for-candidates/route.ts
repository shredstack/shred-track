// GET /api/family/log-for-candidates?communityId=<uuid>
//
// Returns the list of dependents the current user can "log for" in a
// given gym. Surfaced on the score-entry sheet (spec §8 acceptance
// criteria: "Sarah can log a CrossFit score for her son via a userId
// override").

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { communityMemberships } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { isFlagOn } from "@/lib/feature-flags";
import { listLogForCandidates } from "@/lib/family";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const communityId = url.searchParams.get("communityId");
  if (!communityId) {
    return NextResponse.json({ candidates: [] });
  }

  // Caller must be a member of the gym.
  const [membership] = await db
    .select({ id: communityMemberships.id })
    .from(communityMemberships)
    .where(
      and(
        eq(communityMemberships.communityId, communityId),
        eq(communityMemberships.userId, user.id)
      )
    )
    .limit(1);
  if (!membership) {
    return NextResponse.json({ candidates: [] });
  }

  if (!(await isFlagOn("family_memberships", { userId: user.id, communityId }))) {
    return NextResponse.json({ candidates: [] });
  }

  const candidates = await listLogForCandidates(user.id, communityId);
  return NextResponse.json({ candidates });
}
