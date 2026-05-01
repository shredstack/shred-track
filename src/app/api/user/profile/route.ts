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
      bodyWeightLb: users.bodyWeightLb,
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
    bodyWeightLb: user.bodyWeightLb != null ? Number(user.bodyWeightLb) : null,
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
  if ("bodyWeightLb" in body) {
    if (body.bodyWeightLb === null || body.bodyWeightLb === "") {
      updates.bodyWeightLb = null;
    } else {
      const n =
        typeof body.bodyWeightLb === "number"
          ? body.bodyWeightLb
          : parseFloat(body.bodyWeightLb);
      if (!Number.isFinite(n) || n <= 0 || n > 1000) {
        return NextResponse.json(
          { error: "Invalid bodyWeightLb (expect 0–1000 lb)" },
          { status: 400 }
        );
      }
      updates.bodyWeightLb = String(n);
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
      bodyWeightLb: users.bodyWeightLb,
      createdAt: users.createdAt,
    });

  return NextResponse.json({
    ...updated,
    bodyWeightLb:
      updated.bodyWeightLb != null ? Number(updated.bodyWeightLb) : null,
  });
}
