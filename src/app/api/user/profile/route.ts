import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { and, eq, ne, sql } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { isAdminEmail } from "@/lib/admin";

// Lowercase letters, digits, underscores, hyphens; 3–24 chars.
const USERNAME_RE = /^[a-z0-9_-]{3,24}$/;

// GET /api/user/profile — get basic user info
export async function GET() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      email: users.email,
      gender: users.gender,
      unitPreference: users.unitPreference,
      bodyWeightLb: users.bodyWeightLb,
      image: users.image,
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
  if ("username" in body) {
    if (body.username === null || body.username === "") {
      updates.username = null;
    } else if (typeof body.username !== "string") {
      return NextResponse.json({ error: "Invalid username" }, { status: 400 });
    } else {
      const candidate = body.username.trim().toLowerCase();
      if (!USERNAME_RE.test(candidate)) {
        return NextResponse.json(
          {
            error:
              "Username must be 3–24 characters, lowercase letters, digits, _ or -",
          },
          { status: 400 }
        );
      }
      // Case-insensitive uniqueness check excluding the current user.
      const [conflict] = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            sql`lower(${users.username}) = ${candidate}`,
            ne(users.id, session.id)
          )
        )
        .limit(1);
      if (conflict) {
        return NextResponse.json(
          { error: "That username is taken" },
          { status: 409 }
        );
      }
      updates.username = candidate;
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
          { error: "Invalid bodyWeightLb (expect 1–1000 lb)" },
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
      username: users.username,
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
