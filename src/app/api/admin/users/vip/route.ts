// ---------------------------------------------------------------------------
// Admin VIP-flag management.
//
// users.is_vip is a blanket bypass for all paid/AI features. Distinct from
// hyrox_vip_grants (metered HYROX plan allowance, kept for future per-feature
// rate limiting) and from is_admin (admin-panel access).
//
// GET  → list every user with is_vip = true.
// POST → set is_vip = true on the user identified by { email }.
// DELETE lives at /api/admin/users/vip/[userId]/route.ts.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getAdminUser } from "@/lib/admin";

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isVip: users.isVip,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.isVip, true))
    .orderBy(desc(users.updatedAt));

  return NextResponse.json({ vips: rows });
}

export async function POST(req: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { email?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const [target] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!target) {
    return NextResponse.json({ error: "No user with that email" }, { status: 404 });
  }

  const [updated] = await db
    .update(users)
    .set({ isVip: true, updatedAt: new Date() })
    .where(eq(users.id, target.id))
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      isVip: users.isVip,
      updatedAt: users.updatedAt,
    });

  return NextResponse.json({ vip: updated });
}
