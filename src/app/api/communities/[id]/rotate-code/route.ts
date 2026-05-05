// POST /api/communities/[id]/rotate-code
// Body: { customCode?: string }
//
// Generates a fresh join code for the gym (or accepts a custom one). The
// previous code is invalidated immediately. Caller must be a gym admin (or
// super admin).

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { communities } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canAdminGym } from "@/lib/authz/community";
import { v4 as uuidv4 } from "uuid";

const CUSTOM_CODE_RE = /^[A-Z0-9]{4,16}$/;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const caller = await getSessionUser();
  if (!caller)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const ok = await canAdminGym(caller.id, id);
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  let nextCode: string;
  if (body.customCode != null) {
    const candidate = String(body.customCode).trim().toUpperCase();
    if (!CUSTOM_CODE_RE.test(candidate)) {
      return NextResponse.json(
        { error: "Custom code must be 4-16 chars, A-Z and 0-9 only" },
        { status: 400 }
      );
    }
    nextCode = candidate;
  } else {
    nextCode = uuidv4().slice(0, 8).toUpperCase();
  }

  try {
    const [updated] = await db
      .update(communities)
      .set({ joinCode: nextCode, updatedAt: new Date() })
      .where(eq(communities.id, id))
      .returning();
    if (!updated)
      return NextResponse.json({ error: "Gym not found" }, { status: 404 });
    return NextResponse.json({ joinCode: updated.joinCode });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json(
        { error: "That join code is already in use" },
        { status: 409 }
      );
    }
    throw err;
  }
}
