import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  recoveryMovements,
  recoveryMovementVideos,
  recoveryMovementGymOverrides,
  communityMemberships,
} from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { getMovementAccess } from "@/lib/authz/recovery";

// GET /api/recovery/movements/[id]
// Detail view: movement row, videos visible to the caller (ordered per
// spec §4.2), gym notes override (if any).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const access = await getMovementAccess(user.id, id);
  if (!access.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!access.canRead) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [movement] = await db
    .select()
    .from(recoveryMovements)
    .where(eq(recoveryMovements.id, id))
    .limit(1);

  // Caller's active gyms — needed to filter videos and resolve notes.
  const memberships = await db
    .select({ communityId: communityMemberships.communityId })
    .from(communityMemberships)
    .where(
      and(eq(communityMemberships.userId, user.id), eq(communityMemberships.isActive, true))
    );
  const myGyms = memberships.map((m) => m.communityId);

  const allVideos = await db
    .select()
    .from(recoveryMovementVideos)
    .where(eq(recoveryMovementVideos.movementId, id))
    .orderBy(recoveryMovementVideos.orderIndex, recoveryMovementVideos.createdAt);

  const visibleVideos = allVideos.filter((v) => {
    if (v.visibility === "public") return true;
    if (v.visibility === "gym" && v.communityId && myGyms.includes(v.communityId)) return true;
    return false;
  });

  // Override row for caller's first matching active gym (if any).
  let notesOverride: string | null = null;
  if (myGyms.length) {
    const overrides = await db
      .select()
      .from(recoveryMovementGymOverrides)
      .where(
        and(
          eq(recoveryMovementGymOverrides.movementId, id),
          inArray(recoveryMovementGymOverrides.communityId, myGyms)
        )
      );
    if (overrides[0]) notesOverride = overrides[0].notesOverride ?? null;
  }

  return NextResponse.json({
    ...movement,
    notesOverride,
    videos: visibleVideos,
  });
}

// PATCH /api/recovery/movements/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const access = await getMovementAccess(user.id, id);
  if (!access.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!access.canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const updates: Record<string, unknown> = {};
  if (typeof body.canonicalName === "string" && body.canonicalName.trim()) {
    updates.canonicalName = body.canonicalName.trim();
  }
  if (typeof body.description === "string" || body.description === null) {
    updates.description = body.description;
  }
  if (Array.isArray(body.bodyRegion)) updates.bodyRegion = body.bodyRegion;
  if (typeof body.category === "string") updates.category = body.category;
  if (typeof body.isPerSide === "boolean") updates.isPerSide = body.isPerSide;
  if (body.defaultPrescription && typeof body.defaultPrescription === "object") {
    updates.defaultPrescription = body.defaultPrescription;
  }
  updates.updatedAt = new Date();

  const [updated] = await db
    .update(recoveryMovements)
    .set(updates)
    .where(eq(recoveryMovements.id, id))
    .returning();

  return NextResponse.json(updated);
}

// DELETE /api/recovery/movements/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const access = await getMovementAccess(user.id, id);
  if (!access.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!access.canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    await db.delete(recoveryMovements).where(eq(recoveryMovements.id, id));
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("foreign key")) {
      return NextResponse.json(
        { error: "Movement is referenced by schedules or sessions; cannot delete" },
        { status: 409 }
      );
    }
    throw err;
  }
}
