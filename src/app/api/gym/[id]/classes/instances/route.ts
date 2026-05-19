// /api/gym/[id]/classes/instances
//
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD — list class_instances for the gym
// in the date window, with the caller's registration status. Active members
// can view (canViewGym); coach view layers attendance counts on top.

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import {
  classInstances,
  classRegistrations,
  classSchedules,
  users,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym, canViewGym } from "@/lib/authz/community";

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId } = await params;
  if (!(await canViewGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const kindParam = url.searchParams.get("kind");
  if (!from || !to || !isIsoDate(from) || !isIsoDate(to)) {
    return NextResponse.json(
      { error: "from and to are required YYYY-MM-DD" },
      { status: 400 }
    );
  }
  if (kindParam && kindParam !== "class" && kindParam !== "event") {
    return NextResponse.json(
      { error: "kind must be 'class' or 'event'" },
      { status: 400 }
    );
  }
  const fromUtc = new Date(`${from}T00:00:00Z`);
  const toUtc = new Date(`${to}T00:00:00Z`);
  toUtc.setUTCDate(toUtc.getUTCDate() + 1); // inclusive end

  const whereClauses = [
    eq(classInstances.communityId, communityId),
    gte(classInstances.startAt, fromUtc),
    lt(classInstances.startAt, toUtc),
  ];
  if (kindParam) {
    whereClauses.push(eq(classInstances.kind, kindParam));
  }

  const rows = await db
    .select({
      id: classInstances.id,
      scheduleId: classInstances.scheduleId,
      scheduleName: classSchedules.name,
      startAt: classInstances.startAt,
      endAt: classInstances.endAt,
      coachId: classInstances.coachId,
      capacity: classInstances.capacity,
      status: classInstances.status,
      kind: classInstances.kind,
      eventTitle: classInstances.eventTitle,
      eventImageUrl: classInstances.eventImageUrl,
      eventDescription: classInstances.eventDescription,
      workoutId: classInstances.workoutId,
    })
    .from(classInstances)
    .leftJoin(classSchedules, eq(classSchedules.id, classInstances.scheduleId))
    .where(and(...whereClauses))
    .orderBy(asc(classInstances.startAt));

  const instanceIds = rows.map((r) => r.id);
  const isManager = await canManageGym(user.id, communityId);

  const myRegistrations = instanceIds.length
    ? await db
        .select({
          classInstanceId: classRegistrations.classInstanceId,
          status: classRegistrations.status,
        })
        .from(classRegistrations)
        .where(
          and(
            eq(classRegistrations.userId, user.id),
            inArray(classRegistrations.classInstanceId, instanceIds)
          )
        )
    : [];
  const myReg = new Map(
    myRegistrations.map((r) => [r.classInstanceId, r.status])
  );

  // Counts per instance (only when there are instances).
  const counts = instanceIds.length
    ? await db
        .select({
          classInstanceId: classRegistrations.classInstanceId,
          status: classRegistrations.status,
        })
        .from(classRegistrations)
        .where(inArray(classRegistrations.classInstanceId, instanceIds))
    : [];

  const registeredCount = new Map<string, number>();
  for (const c of counts) {
    if (c.status === "registered" || c.status === "attended") {
      registeredCount.set(
        c.classInstanceId,
        (registeredCount.get(c.classInstanceId) ?? 0) + 1
      );
    }
  }

  // Coach names (small set, batched).
  const coachIds = [...new Set(rows.map((r) => r.coachId).filter(Boolean))] as string[];
  const coaches = coachIds.length
    ? await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, coachIds))
    : [];
  const coachName = new Map(coaches.map((c) => [c.id, c.name]));

  return NextResponse.json({
    instances: rows.map((r) => ({
      id: r.id,
      scheduleId: r.scheduleId,
      name: r.eventTitle ?? r.scheduleName ?? "Class",
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
      coachId: r.coachId,
      coachName: r.coachId ? coachName.get(r.coachId) ?? null : null,
      capacity: r.capacity,
      status: r.status,
      kind: r.kind,
      eventTitle: r.eventTitle ?? null,
      eventImageUrl: r.eventImageUrl ?? null,
      eventDescription: r.eventDescription ?? null,
      workoutId: r.workoutId,
      registeredCount: registeredCount.get(r.id) ?? 0,
      myStatus: myReg.get(r.id) ?? null,
      isManager,
    })),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Manual one-off creation (used for events). Coach/admin only.
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId } = await params;
  if (!(await canManageGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  if (!body || !body.startAt || !body.endAt) {
    return NextResponse.json(
      { error: "startAt and endAt are required" },
      { status: 400 }
    );
  }
  const [row] = await db
    .insert(classInstances)
    .values({
      communityId,
      scheduleId: body.scheduleId ?? null,
      startAt: new Date(body.startAt),
      endAt: new Date(body.endAt),
      coachId: body.coachId ?? null,
      capacity:
        typeof body.capacity === "number" && body.capacity > 0
          ? body.capacity
          : 20,
      kind: body.kind === "event" ? "event" : "class",
      eventTitle: body.eventTitle ?? null,
      eventImageUrl: body.eventImageUrl ?? null,
      eventDescription: body.eventDescription ?? null,
      workoutId: body.workoutId ?? null,
    })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
