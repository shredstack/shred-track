import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  recoveryRoutines,
  recoveryRoutineMovements,
  recoveryMovements,
  communityMemberships,
} from "@/db/schema";
import { and, eq, inArray, or, isNull } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { canCreateGymRoutine } from "@/lib/authz/recovery";

// GET — list routines visible to the caller.
// Visible = mine, validated globally (community_id IS NULL AND is_validated),
// or scoped to one of my active gyms.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const memberships = await db
    .select({ communityId: communityMemberships.communityId })
    .from(communityMemberships)
    .where(
      and(eq(communityMemberships.userId, user.id), eq(communityMemberships.isActive, true))
    );
  const myGyms = memberships.map((m) => m.communityId);

  const conditions = [
    eq(recoveryRoutines.createdBy, user.id),
    and(isNull(recoveryRoutines.communityId), eq(recoveryRoutines.isValidated, true))!,
  ];
  if (myGyms.length) {
    conditions.push(inArray(recoveryRoutines.communityId, myGyms));
  }

  const rows = await db
    .select()
    .from(recoveryRoutines)
    .where(or(...conditions)!)
    .orderBy(recoveryRoutines.name);

  if (rows.length === 0) return NextResponse.json([]);

  // Pull child movements for each routine.
  const ids = rows.map((r) => r.id);
  const children = await db
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
    .where(inArray(recoveryRoutineMovements.routineId, ids))
    .orderBy(recoveryRoutineMovements.routineId, recoveryRoutineMovements.orderIndex);

  const childByRoutine = new Map<string, typeof children>();
  for (const c of children) {
    const arr = childByRoutine.get(c.child.routineId) ?? [];
    arr.push(c);
    childByRoutine.set(c.child.routineId, arr);
  }

  return NextResponse.json(
    rows.map((r) => ({
      ...r,
      movements: (childByRoutine.get(r.id) ?? []).map((c) => ({
        ...c.child,
        movementName: c.movementName,
        isPerSide: c.isPerSide,
      })),
    }))
  );
}

// POST — create a routine.
// Body: { name, description?, communityId?, movements: [{ movementId, orderIndex, prescription?, notes? }] }
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const communityId: string | null = body.communityId ?? null;
  if (!(await canCreateGymRoutine(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const movements = Array.isArray(body.movements) ? body.movements : [];

  const result = await db.transaction(async (tx) => {
    const [routine] = await tx
      .insert(recoveryRoutines)
      .values({
        name,
        description: body.description ?? null,
        communityId,
        createdBy: user.id,
        isValidated: communityId !== null, // gym-scoped is auto-trusted; personal stays unvalidated
      })
      .returning();

    if (movements.length) {
      await tx.insert(recoveryRoutineMovements).values(
        movements.map((m: { movementId: string; orderIndex?: number; prescription?: object; notes?: string }, i: number) => ({
          routineId: routine.id,
          movementId: m.movementId,
          orderIndex: typeof m.orderIndex === "number" ? m.orderIndex : i,
          prescription: m.prescription ?? {},
          notes: m.notes ?? null,
        }))
      );
    }

    return routine;
  });

  return NextResponse.json(result, { status: 201 });
}
