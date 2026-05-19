// POST /api/classes/[id]/register
//
// Register the caller for a class instance. Idempotent: re-registering
// after cancelling flips the row's status back to 'registered'. Members
// of the gym only.

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { classInstances, classRegistrations } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canViewGym } from "@/lib/authz/community";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: classInstanceId } = await params;

  const [instance] = await db
    .select({
      id: classInstances.id,
      communityId: classInstances.communityId,
      capacity: classInstances.capacity,
      status: classInstances.status,
    })
    .from(classInstances)
    .where(eq(classInstances.id, classInstanceId))
    .limit(1);
  if (!instance) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }
  if (instance.status === "cancelled") {
    return NextResponse.json(
      { error: "Class was cancelled" },
      { status: 400 }
    );
  }
  if (!(await canViewGym(user.id, instance.communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Capacity check: if already at capacity and the caller doesn't have a
  // registered row, refuse.
  const result = await db.transaction(async (tx) => {
    const [taken] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(classRegistrations)
      .where(
        and(
          eq(classRegistrations.classInstanceId, classInstanceId),
          // Only registered + attended count toward capacity.
          sql`${classRegistrations.status} in ('registered','attended')`
        )
      );
    const [existing] = await tx
      .select({
        id: classRegistrations.id,
        status: classRegistrations.status,
      })
      .from(classRegistrations)
      .where(
        and(
          eq(classRegistrations.classInstanceId, classInstanceId),
          eq(classRegistrations.userId, user.id)
        )
      )
      .limit(1);

    const alreadyHolding =
      existing?.status === "registered" || existing?.status === "attended";
    if (
      !alreadyHolding &&
      (taken?.n ?? 0) >= instance.capacity
    ) {
      return { ok: false as const, reason: "capacity" };
    }

    if (existing) {
      await tx
        .update(classRegistrations)
        .set({
          status: "registered",
          registeredAt: new Date(),
          cancelledAt: null,
        })
        .where(eq(classRegistrations.id, existing.id));
      return { ok: true as const };
    }
    await tx.insert(classRegistrations).values({
      classInstanceId,
      userId: user.id,
      status: "registered",
    });
    return { ok: true as const };
  });

  if (!result.ok) {
    return NextResponse.json({ error: "Class full" }, { status: 409 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: classInstanceId } = await params;
  await db
    .update(classRegistrations)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(
      and(
        eq(classRegistrations.classInstanceId, classInstanceId),
        eq(classRegistrations.userId, user.id)
      )
    );
  return new NextResponse(null, { status: 204 });
}
