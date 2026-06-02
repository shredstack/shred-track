import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db } from "@/db";
import {
  hyroxRaceTemplates,
  communityMemberships,
} from "@/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";

// ---------------------------------------------------------------------------
// POST — clone a gym-shared template into the caller's own list.
//
// Authorization: the source row must have a `communityId` set, and the
// caller must be an active member of that same community. The clone is
// always private (communityId = null) so editing it doesn't leak back
// to the original gym list.
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

  const [source] = await db
    .select()
    .from(hyroxRaceTemplates)
    .where(
      and(
        eq(hyroxRaceTemplates.id, id),
        isNotNull(hyroxRaceTemplates.communityId),
      ),
    )
    .limit(1);

  if (!source) {
    return NextResponse.json(
      { error: "Template not found or not shared" },
      { status: 404 },
    );
  }

  // Verify caller is an active member of the gym the source is shared with.
  const [membership] = await db
    .select({ id: communityMemberships.id })
    .from(communityMemberships)
    .where(
      and(
        eq(communityMemberships.userId, user.id),
        eq(communityMemberships.communityId, source.communityId!),
        eq(communityMemberships.isActive, true),
      ),
    )
    .limit(1);

  if (!membership) {
    return NextResponse.json(
      { error: "You're not a member of that gym" },
      { status: 403 },
    );
  }

  const [clone] = await db
    .insert(hyroxRaceTemplates)
    .values({
      userId: user.id,
      name: source.name,
      divisionKey: source.divisionKey,
      simulateRoxzone: source.simulateRoxzone,
      segments: source.segments,
      communityId: null,
      clonedFromId: source.id,
    })
    .returning();

  return NextResponse.json(clone, { status: 201 });
}
