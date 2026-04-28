import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { isAdminEmail } from "@/lib/admin";

// GET /api/user/profile — get basic user info
export async function GET() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      gender: users.gender,
      unitPreference: users.unitPreference,
      isAdmin: users.isAdmin,
      isVip: users.isVip,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, session.id))
    .limit(1);

  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  return NextResponse.json({
    ...user,
    isAdmin: user.isAdmin || isAdminEmail(user.email),
  });
}

// PUT /api/user/profile — update basic user info
export async function PUT(req: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.name === "string" && body.name.trim()) {
    updates.name = body.name.trim();
  }
  if ("gender" in body) {
    // Accept "male" | "female" | "other" | null. Anything else is rejected
    // so we don't end up with arbitrary strings shaping decomposition.
    if (body.gender === null) {
      updates.gender = null;
    } else if (
      body.gender === "male" ||
      body.gender === "female" ||
      body.gender === "other"
    ) {
      updates.gender = body.gender;
    } else {
      return NextResponse.json({ error: "Invalid gender" }, { status: 400 });
    }
  }

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, session.id))
    .returning({
      id: users.id,
      name: users.name,
      email: users.email,
      gender: users.gender,
      unitPreference: users.unitPreference,
      createdAt: users.createdAt,
    });

  return NextResponse.json(updated);
}
