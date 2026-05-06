import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { recoveryMovementGymOverrides, recoveryMovements } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { canEditGymOverride } from "@/lib/authz/recovery";

// PUT — upsert the gym's notes override for this movement.
// Body: { communityId, notesOverride }
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const [movement] = await db
    .select({ id: recoveryMovements.id })
    .from(recoveryMovements)
    .where(eq(recoveryMovements.id, id))
    .limit(1);
  if (!movement) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const communityId = body.communityId;
  if (!communityId) return NextResponse.json({ error: "communityId is required" }, { status: 400 });

  if (!(await canEditGymOverride(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const notesOverride = typeof body.notesOverride === "string" ? body.notesOverride : null;

  const [existing] = await db
    .select()
    .from(recoveryMovementGymOverrides)
    .where(
      and(
        eq(recoveryMovementGymOverrides.movementId, id),
        eq(recoveryMovementGymOverrides.communityId, communityId)
      )
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(recoveryMovementGymOverrides)
      .set({ notesOverride, updatedAt: new Date() })
      .where(eq(recoveryMovementGymOverrides.id, existing.id))
      .returning();
    return NextResponse.json(updated);
  }

  const [inserted] = await db
    .insert(recoveryMovementGymOverrides)
    .values({ movementId: id, communityId, notesOverride, createdBy: user.id })
    .returning();
  return NextResponse.json(inserted, { status: 201 });
}

// DELETE — clear the override (body: { communityId })
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const communityId = body.communityId;
  if (!communityId) return NextResponse.json({ error: "communityId is required" }, { status: 400 });

  if (!(await canEditGymOverride(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db
    .delete(recoveryMovementGymOverrides)
    .where(
      and(
        eq(recoveryMovementGymOverrides.movementId, id),
        eq(recoveryMovementGymOverrides.communityId, communityId)
      )
    );

  return NextResponse.json({ ok: true });
}
