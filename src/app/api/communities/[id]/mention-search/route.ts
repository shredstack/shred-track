// Mention autocomplete — any active member can search by name or username.
// Distinct from the admin-only roster endpoint at /api/communities/:id/members
// because that returns email and role flags; this returns minimal display
// fields and is safe for every member to call.

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { communityMemberships, users } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canViewGym } from "@/lib/authz/community";

const MAX_LIMIT = 20;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: communityId } = await params;
  if (!(await canViewGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limitParam = Number(url.searchParams.get("limit") ?? "10");
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(1, Math.floor(limitParam)), MAX_LIMIT)
    : 10;

  // Empty query: return the first N members alphabetically by display name.
  // Lets the picker render something useful before the user types anything.
  const nameFilter = q.length > 0
    ? or(
        ilike(users.name, `${q}%`),
        ilike(sql`coalesce(${users.username}, '')`, `${q}%`)
      )
    : undefined;

  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      username: users.username,
      image: users.image,
    })
    .from(communityMemberships)
    .innerJoin(users, eq(users.id, communityMemberships.userId))
    .where(
      and(
        eq(communityMemberships.communityId, communityId),
        eq(communityMemberships.isActive, true),
        // Dependents spec §3.6: shadow users never appear in the
        // @-mention typeahead.
        eq(users.isShadow, false),
        nameFilter
      )
    )
    .orderBy(asc(users.name))
    .limit(limit);

  return NextResponse.json({ members: rows });
}
