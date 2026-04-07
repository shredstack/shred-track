import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { communities, communityMemberships } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// POST /api/communities/join — join a community with a code
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { code } = body;
  if (!code || typeof code !== "string") {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  const [community] = await db
    .select()
    .from(communities)
    .where(eq(communities.joinCode, code.toUpperCase()))
    .limit(1);

  if (!community) {
    return NextResponse.json({ error: "Invalid join code" }, { status: 404 });
  }

  try {
    await db.insert(communityMemberships).values({
      communityId: community.id,
      userId: user.id,
      role: "member",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("unique") || message.includes("duplicate")) {
      return NextResponse.json({ error: "Already a member" }, { status: 409 });
    }
    throw err;
  }

  return NextResponse.json({ communityId: community.id, name: community.name }, { status: 200 });
}
