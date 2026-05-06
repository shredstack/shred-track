import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  recoveryRoutines,
  recoveryRoutineMovements,
  recoveryMovements,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { getRoutineAccess } from "@/lib/authz/recovery";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const access = await getRoutineAccess(user.id, id);
  if (!access.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!access.canRead) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [routine] = await db
    .select()
    .from(recoveryRoutines)
    .where(eq(recoveryRoutines.id, id))
    .limit(1);

  const movements = await db
    .select({
      child: recoveryRoutineMovements,
      movementName: recoveryMovements.canonicalName,
      isPerSide: recoveryMovements.isPerSide,
    })
    .from(recoveryRoutineMovements)
    .innerJoin(
      recoveryMovements,
      eq(recoveryRoutineMovements.movementId, recoveryMovements.id)
    )
    .where(eq(recoveryRoutineMovements.routineId, id))
    .orderBy(recoveryRoutineMovements.orderIndex);

  return NextResponse.json({
    ...routine,
    movements: movements.map((m) => ({
      ...m.child,
      movementName: m.movementName,
      isPerSide: m.isPerSide,
    })),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const access = await getRoutineAccess(user.id, id);
  if (!access.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!access.canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const updates: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
  if (typeof body.description === "string" || body.description === null) {
    updates.description = body.description;
  }
  updates.updatedAt = new Date();

  await db.transaction(async (tx) => {
    if (Object.keys(updates).length) {
      await tx.update(recoveryRoutines).set(updates).where(eq(recoveryRoutines.id, id));
    }

    if (Array.isArray(body.movements)) {
      // Replace child rows wholesale to keep transactional consistency.
      await tx.delete(recoveryRoutineMovements).where(eq(recoveryRoutineMovements.routineId, id));
      if (body.movements.length) {
        await tx.insert(recoveryRoutineMovements).values(
          body.movements.map((m: { movementId: string; orderIndex?: number; prescription?: object; notes?: string }, i: number) => ({
            routineId: id,
            movementId: m.movementId,
            orderIndex: typeof m.orderIndex === "number" ? m.orderIndex : i,
            prescription: m.prescription ?? {},
            notes: m.notes ?? null,
          }))
        );
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

  const access = await getRoutineAccess(user.id, id);
  if (!access.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!access.canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await db.delete(recoveryRoutines).where(eq(recoveryRoutines.id, id));
  return NextResponse.json({ ok: true });
}
