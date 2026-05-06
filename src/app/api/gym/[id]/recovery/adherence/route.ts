import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  communityMemberships,
  recoverySessions,
  recoverySessionItems,
  users,
} from "@/db/schema";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { canProgramForGym } from "@/lib/authz/community";

// GET /api/gym/[id]/recovery/adherence?weeks=4
//
// Per-athlete recovery completion stats over the trailing N weeks for
// active members of the caller's gym. Coach/admin only.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId } = await params;

  if (!(await canProgramForGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const weeks = Math.max(1, Math.min(12, Number(url.searchParams.get("weeks") ?? "4")));

  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - weeks * 7);
  const startKey = startDate.toISOString().slice(0, 10);
  const endKey = today.toISOString().slice(0, 10);

  // Active members of the gym, joined to their user row for name/email.
  const members = await db
    .select({
      userId: communityMemberships.userId,
      isCoach: communityMemberships.isCoach,
      isAdmin: communityMemberships.isAdmin,
      name: users.name,
      email: users.email,
    })
    .from(communityMemberships)
    .innerJoin(users, eq(communityMemberships.userId, users.id))
    .where(
      and(
        eq(communityMemberships.communityId, communityId),
        eq(communityMemberships.isActive, true)
      )
    );

  if (members.length === 0) {
    return NextResponse.json({ weeks, startDate: startKey, endDate: endKey, athletes: [] });
  }

  const userIds = members.map((m) => m.userId);

  const sessions = await db
    .select({
      id: recoverySessions.id,
      userId: recoverySessions.userId,
      sessionDate: recoverySessions.sessionDate,
      status: recoverySessions.status,
      completedAt: recoverySessions.completedAt,
    })
    .from(recoverySessions)
    .where(
      and(
        inArray(recoverySessions.userId, userIds),
        gte(recoverySessions.sessionDate, startKey),
        lte(recoverySessions.sessionDate, endKey)
      )
    );

  // Aggregate skipped items per session in one query so we don't N+1 by user.
  const sessionIds = sessions.map((s) => s.id);
  const skipsBySession = new Map<string, number>();
  if (sessionIds.length) {
    const skips = await db
      .select({
        sessionId: recoverySessionItems.sessionId,
        status: recoverySessionItems.status,
      })
      .from(recoverySessionItems)
      .where(
        and(
          inArray(recoverySessionItems.sessionId, sessionIds),
          eq(recoverySessionItems.status, "skipped")
        )
      );
    for (const s of skips) {
      skipsBySession.set(s.sessionId, (skipsBySession.get(s.sessionId) ?? 0) + 1);
    }
  }

  type Bucket = {
    sessionsStarted: number;
    sessionsCompleted: number;
    skippedItems: number;
    lastSessionDate: string | null;
  };
  const stats = new Map<string, Bucket>();
  for (const s of sessions) {
    const b = stats.get(s.userId) ?? {
      sessionsStarted: 0,
      sessionsCompleted: 0,
      skippedItems: 0,
      lastSessionDate: null as string | null,
    };
    b.sessionsStarted += 1;
    if (s.status === "complete") b.sessionsCompleted += 1;
    b.skippedItems += skipsBySession.get(s.id) ?? 0;
    if (!b.lastSessionDate || s.sessionDate > b.lastSessionDate) {
      b.lastSessionDate = s.sessionDate;
    }
    stats.set(s.userId, b);
  }

  const athletes = members
    .map((m) => {
      const s = stats.get(m.userId) ?? {
        sessionsStarted: 0,
        sessionsCompleted: 0,
        skippedItems: 0,
        lastSessionDate: null,
      };
      return {
        userId: m.userId,
        name: m.name,
        email: m.email,
        isCoach: m.isCoach,
        isAdmin: m.isAdmin,
        ...s,
      };
    })
    .sort((a, b) => {
      // Active athletes (any sessions) first; then by name.
      if (a.sessionsStarted !== b.sessionsStarted)
        return b.sessionsStarted - a.sessionsStarted;
      return (a.name || a.email).localeCompare(b.name || b.email);
    });

  return NextResponse.json({
    weeks,
    startDate: startKey,
    endDate: endKey,
    athletes,
  });
}
