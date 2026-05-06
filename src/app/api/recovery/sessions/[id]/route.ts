import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  recoverySessions,
  recoverySessionItems,
  recoveryMovements,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { canReadSession } from "@/lib/authz/recovery";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const ok = await canReadSession(user.id, id);
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [session] = await db
    .select()
    .from(recoverySessions)
    .where(eq(recoverySessions.id, id))
    .limit(1);
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const items = await db
    .select({
      i: recoverySessionItems,
      movementName: recoveryMovements.canonicalName,
      isPerSide: recoveryMovements.isPerSide,
    })
    .from(recoverySessionItems)
    .innerJoin(recoveryMovements, eq(recoverySessionItems.movementId, recoveryMovements.id))
    .where(eq(recoverySessionItems.sessionId, id))
    .orderBy(recoverySessionItems.orderIndex);

  return NextResponse.json({
    ...session,
    items: items.map((row) => ({
      ...row.i,
      movementName: row.movementName,
      isPerSide: row.isPerSide,
    })),
  });
}

// PATCH — update session-level fields (status, notes) and/or item statuses/actuals.
// Body: { status?, notes?, items?: [{ id, status?, actual?, notes? }] }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const [session] = await db
    .select()
    .from(recoverySessions)
    .where(eq(recoverySessions.id, id))
    .limit(1);
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (session.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();

  await db.transaction(async (tx) => {
    const updates: Record<string, unknown> = {};
    if (typeof body.status === "string" && ["in_progress", "complete", "skipped"].includes(body.status)) {
      updates.status = body.status;
      if (body.status === "complete") updates.completedAt = new Date();
    }
    if (typeof body.notes === "string" || body.notes === null) updates.notes = body.notes;
    if (Object.keys(updates).length) {
      await tx.update(recoverySessions).set(updates).where(eq(recoverySessions.id, id));
    }

    if (Array.isArray(body.items)) {
      for (const it of body.items) {
        const itemUpdates: Record<string, unknown> = {};
        if (typeof it.status === "string" && ["pending", "done", "skipped"].includes(it.status)) {
          itemUpdates.status = it.status;
        }
        if (it.actual && typeof it.actual === "object") itemUpdates.actual = it.actual;
        if (typeof it.notes === "string" || it.notes === null) itemUpdates.notes = it.notes;
        if (Object.keys(itemUpdates).length) {
          await tx
            .update(recoverySessionItems)
            .set(itemUpdates)
            .where(
              and(
                eq(recoverySessionItems.id, it.id),
                eq(recoverySessionItems.sessionId, id)
              )
            );
        }
      }
    }
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const [session] = await db
    .select()
    .from(recoverySessions)
    .where(eq(recoverySessions.id, id))
    .limit(1);
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (session.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.delete(recoverySessions).where(eq(recoverySessions.id, id));
  return NextResponse.json({ ok: true });
}
