// ---------------------------------------------------------------------------
// Admin VIP management.
//
// GET  → list all VIP grants with the associated user email/name.
// POST → grant or update VIP status for a user.
//        Body: { email: string, plansPerYear: number, notes?: string }
//
// DELETE lives at /api/admin/hyrox/vip/[userId]/route.ts.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { hyroxVipGrants, users } from "@/db/schema";
import { getAdminUser } from "@/lib/admin";
import { upsertVipGrant } from "@/lib/plan-credits";

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = await db
    .select({
      userId: hyroxVipGrants.userId,
      plansPerYear: hyroxVipGrants.plansPerYear,
      active: hyroxVipGrants.active,
      notes: hyroxVipGrants.notes,
      createdAt: hyroxVipGrants.createdAt,
      updatedAt: hyroxVipGrants.updatedAt,
      email: users.email,
      name: users.name,
    })
    .from(hyroxVipGrants)
    .innerJoin(users, eq(users.id, hyroxVipGrants.userId))
    .orderBy(desc(hyroxVipGrants.updatedAt));

  return NextResponse.json({ grants: rows });
}

export async function POST(req: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { email?: unknown; plansPerYear?: unknown; notes?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const plansPerYear = typeof body.plansPerYear === "number" ? body.plansPerYear : NaN;
  const notes = typeof body.notes === "string" ? body.notes : null;

  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }
  if (!Number.isInteger(plansPerYear) || plansPerYear < 0 || plansPerYear > 100) {
    return NextResponse.json(
      { error: "plansPerYear must be an integer 0–100" },
      { status: 400 },
    );
  }

  const [target] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!target) {
    return NextResponse.json({ error: "No user with that email" }, { status: 404 });
  }

  const grant = await upsertVipGrant({
    userId: target.id,
    plansPerYear,
    grantedBy: admin.id,
    notes,
  });

  return NextResponse.json({
    grant: { ...grant, email: target.email, name: target.name },
  });
}
