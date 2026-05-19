// GET /api/me/feature-flags
//
// Returns the resolved feature flag map for the current user + active gym.
// Used by useFeatureFlag() on the client. Server components should call
// getAllFlags() directly from src/lib/feature-flags.ts.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { getAllFlags } from "@/lib/feature-flags";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    // Anonymous callers get an empty map. The hook treats undefined as
    // off, so anonymous flows just no-op.
    return NextResponse.json({});
  }

  const [row] = await db
    .select({ activeCommunityId: users.activeCommunityId })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  const flags = await getAllFlags({
    userId: user.id,
    communityId: row?.activeCommunityId ?? null,
  });

  return NextResponse.json(flags);
}
