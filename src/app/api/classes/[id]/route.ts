// GET /api/classes/[id]  — instance detail + roster (gym members only).
// PATCH /api/classes/[id] — cancel (coach/admin only) → emits class_cancelled.

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  classInstances,
  classRegistrations,
  classSchedules,
  communityMemberships,
  notifications,
  users,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym, canViewGym } from "@/lib/authz/community";
import { inngest } from "@/inngest/client";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const [row] = await db
    .select({
      instance: classInstances,
      scheduleName: classSchedules.name,
      scheduleDescription: classSchedules.description,
      coachName: users.name,
      coachImage: users.image,
    })
    .from(classInstances)
    .leftJoin(classSchedules, eq(classSchedules.id, classInstances.scheduleId))
    .leftJoin(users, eq(users.id, classInstances.coachId))
    .where(eq(classInstances.id, id))
    .limit(1);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { instance, scheduleName, scheduleDescription, coachName, coachImage } = row;
  if (!(await canViewGym(user.id, instance.communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const isManager = await canManageGym(user.id, instance.communityId);
  const roster = await db
    .select({
      registrationId: classRegistrations.id,
      userId: classRegistrations.userId,
      userName: users.name,
      userImage: users.image,
      status: classRegistrations.status,
      registeredAt: classRegistrations.registeredAt,
    })
    .from(classRegistrations)
    .innerJoin(users, eq(users.id, classRegistrations.userId))
    .where(eq(classRegistrations.classInstanceId, id))
    .orderBy(asc(classRegistrations.registeredAt));

  // Event metadata lives on the instance; regular classes inherit name +
  // description from their schedule.
  const displayName =
    instance.kind === "event"
      ? instance.eventTitle ?? scheduleName ?? "Event"
      : scheduleName ?? "Class";
  const displayDescription =
    instance.kind === "event"
      ? instance.eventDescription
      : scheduleDescription;
  const myEntry = roster.find((r) => r.userId === user.id);
  const myStatus = myEntry ? myEntry.status : null;

  return NextResponse.json({
    instance: {
      ...instance,
      startAt: instance.startAt.toISOString(),
      endAt: instance.endAt.toISOString(),
      name: displayName,
      description: displayDescription,
      coachName,
      coachImage,
      myStatus,
    },
    isManager,
    roster: isManager
      ? roster.map((r) => ({ ...r, registeredAt: r.registeredAt.toISOString() }))
      : // Members see first names + avatars only (privacy per spec §2.2).
        roster
          .filter((r) => r.status === "registered" || r.status === "attended")
          .map((r) => ({
            registrationId: r.registrationId,
            userId: r.userId,
            userName: r.userName.split(/\s+/)[0],
            userImage: r.userImage,
            status: r.status,
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
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const [instance] = await db
    .select({ id: classInstances.id, communityId: classInstances.communityId, status: classInstances.status })
    .from(classInstances)
    .where(eq(classInstances.id, id))
    .limit(1);
  if (!instance) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canManageGym(user.id, instance.communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (body.action === "edit-coach") {
    // Assign or clear the coach for a single class instance. Overrides the
    // schedule's default coach for this date only; the unique slot/start_at
    // index ensures the next materialize run preserves the override.
    const rawCoach = body.coachId;
    if (rawCoach !== null && typeof rawCoach !== "string") {
      return NextResponse.json(
        { error: "coachId must be a string or null" },
        { status: 400 }
      );
    }
    if (rawCoach) {
      const [member] = await db
        .select({ isCoach: communityMemberships.isCoach, isAdmin: communityMemberships.isAdmin })
        .from(communityMemberships)
        .where(
          and(
            eq(communityMemberships.communityId, instance.communityId),
            eq(communityMemberships.userId, rawCoach),
            eq(communityMemberships.isActive, true)
          )
        )
        .limit(1);
      if (!member || (!member.isCoach && !member.isAdmin)) {
        return NextResponse.json(
          { error: "Coach not in this gym" },
          { status: 400 }
        );
      }
    }
    await db
      .update(classInstances)
      .set({ coachId: rawCoach })
      .where(eq(classInstances.id, id));
    return NextResponse.json({ ok: true });
  }
  if (body.action === "edit-event") {
    // Admin edits event-only metadata. Reject when applied to a
    // schedule-derived class so the materializer doesn't have its
    // values overwritten.
    const updates: Record<string, unknown> = {};
    if (typeof body.eventTitle === "string")
      updates.eventTitle = body.eventTitle.trim() || null;
    if (typeof body.eventDescription === "string")
      updates.eventDescription = body.eventDescription.trim() || null;
    if (typeof body.eventImageUrl === "string")
      updates.eventImageUrl = body.eventImageUrl.trim() || null;
    if (typeof body.capacity === "number" && body.capacity > 0)
      updates.capacity = body.capacity;
    if (typeof body.startAt === "string")
      updates.startAt = new Date(body.startAt);
    if (typeof body.endAt === "string") updates.endAt = new Date(body.endAt);
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No updates" }, { status: 400 });
    }
    await db
      .update(classInstances)
      .set(updates)
      .where(eq(classInstances.id, id));
    return NextResponse.json({ ok: true });
  }
  if (body.action === "cancel") {
    await db
      .update(classInstances)
      .set({
        status: "cancelled",
        cancellationReason: body.reason ?? null,
      })
      .where(eq(classInstances.id, id));

    // Notify everyone who was registered (other than the admin cancelling).
    const registrations = await db
      .select({ userId: classRegistrations.userId })
      .from(classRegistrations)
      .where(
        and(
          eq(classRegistrations.classInstanceId, id),
          eq(classRegistrations.status, "registered")
        )
      );
    const recipients = registrations.filter((r) => r.userId !== user.id);
    if (recipients.length) {
      const inserted = await db
        .insert(notifications)
        .values(
          recipients.map((r) => ({
            recipientId: r.userId,
            actorId: user.id,
            kind: "class_cancelled",
            communityId: instance.communityId,
            classInstanceId: id,
          }))
        )
        .returning({ id: notifications.id });
      // Fan out push delivery.
      for (const n of inserted) {
        try {
          await inngest.send({
            id: `dispatch:${n.id}`,
            name: "notifications/created",
            data: { notificationId: n.id },
          });
        } catch (err) {
          console.error("[classes] dispatch send failed", err);
        }
      }
    }
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
