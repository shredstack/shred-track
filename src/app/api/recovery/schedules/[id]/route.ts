import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  recoverySchedules,
  recoveryScheduleSlots,
  recoveryMovements,
  recoveryRoutines,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { getScheduleAccess } from "@/lib/authz/recovery";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const access = await getScheduleAccess(user.id, id);
  if (!access.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!access.canRead) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [schedule] = await db
    .select()
    .from(recoverySchedules)
    .where(eq(recoverySchedules.id, id))
    .limit(1);

  const slots = await db
    .select({
      slot: recoveryScheduleSlots,
      movementName: recoveryMovements.canonicalName,
      isPerSide: recoveryMovements.isPerSide,
      routineName: recoveryRoutines.name,
    })
    .from(recoveryScheduleSlots)
    .leftJoin(recoveryMovements, eq(recoveryScheduleSlots.movementId, recoveryMovements.id))
    .leftJoin(recoveryRoutines, eq(recoveryScheduleSlots.routineId, recoveryRoutines.id))
    .where(eq(recoveryScheduleSlots.scheduleId, id))
    .orderBy(recoveryScheduleSlots.dayIndex, recoveryScheduleSlots.orderIndex);

  return NextResponse.json({
    ...schedule,
    slots: slots.map((s) => ({
      ...s.slot,
      movementName: s.movementName ?? undefined,
      isPerSide: s.isPerSide ?? undefined,
      routineName: s.routineName ?? undefined,
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

  const access = await getScheduleAccess(user.id, id);
  if (!access.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!access.canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const updates: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
  if (typeof body.description === "string" || body.description === null) updates.description = body.description;
  if (typeof body.rotationDays === "number") updates.rotationDays = body.rotationDays;
  if (typeof body.weeklyTarget === "number") updates.weeklyTarget = body.weeklyTarget;
  if (body.rotationStrategy === "progress" || body.rotationStrategy === "calendar") {
    updates.rotationStrategy = body.rotationStrategy;
  }
  if (typeof body.isArchived === "boolean") updates.isArchived = body.isArchived;
  if (typeof body.isActive === "boolean") updates.isActive = body.isActive;
  if (body.activeDaysOfWeek === null) {
    updates.activeDaysOfWeek = null;
  } else if (Array.isArray(body.activeDaysOfWeek)) {
    // Validate: each entry is a 0..6 integer; dedupe and sort.
    const filtered = Array.from(
      new Set(
        body.activeDaysOfWeek.filter(
          (d: unknown) => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6
        ) as number[]
      )
    ).sort((a, b) => a - b);
    updates.activeDaysOfWeek = filtered;
  }
  updates.updatedAt = new Date();

  await db.transaction(async (tx) => {
    if (Object.keys(updates).length) {
      await tx.update(recoverySchedules).set(updates).where(eq(recoverySchedules.id, id));
    }
    if (Array.isArray(body.slots)) {
      const [current] = await tx
        .select({ kind: recoverySchedules.kind })
        .from(recoverySchedules)
        .where(eq(recoverySchedules.id, id))
        .limit(1);
      const kind = current?.kind ?? "day_keyed";
      await tx.delete(recoveryScheduleSlots).where(eq(recoveryScheduleSlots.scheduleId, id));
      if (body.slots.length) {
        await tx.insert(recoveryScheduleSlots).values(
          body.slots.map((s: { dayIndex?: number | null; orderIndex?: number; movementId?: string | null; routineId?: string | null; prescription?: object; notes?: string | null }, i: number) => ({
            scheduleId: id,
            dayIndex: kind === "day_keyed" ? s.dayIndex ?? null : null,
            orderIndex: typeof s.orderIndex === "number" ? s.orderIndex : i,
            movementId: s.movementId ?? null,
            routineId: s.routineId ?? null,
            prescription: s.prescription ?? {},
            notes: s.notes ?? null,
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

  const access = await getScheduleAccess(user.id, id);
  if (!access.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!access.canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await db.delete(recoverySchedules).where(eq(recoverySchedules.id, id));
  return NextResponse.json({ ok: true });
}
