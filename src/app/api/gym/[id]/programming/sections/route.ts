// POST   /api/gym/[id]/programming/sections          — create a section on a day
// PATCH  /api/gym/[id]/programming/sections          — update an existing section
// DELETE /api/gym/[id]/programming/sections?id=…     — remove a section
//
// In the unified schema a "section" IS a `workout_sessions` row scoped by
// (community_id, workout_date, position). Coach/admin only. Stamps
// `reviewed_at` whenever a PATCH touches user-edited fields so the CAP
// re-paste guard skips it.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  WORKOUT_SESSION_KINDS,
  WORKOUT_SESSION_SCORE_TYPES,
  programmingReleases,
  workoutSessions,
  type WorkoutSessionKind,
  type WorkoutSessionScoreType,
  FREEFORM_SESSION_KINDS,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";
import {
  createSession,
  nextPositionForDay,
  updateSession,
} from "@/lib/crossfit/session-writer";

function isValidKind(v: unknown): v is WorkoutSessionKind {
  return (
    typeof v === "string" &&
    (WORKOUT_SESSION_KINDS as readonly string[]).includes(v)
  );
}
function isValidScoreType(
  v: unknown
): v is WorkoutSessionScoreType | null | undefined {
  if (v === null || v === undefined) return true;
  return (
    typeof v === "string" &&
    (WORKOUT_SESSION_SCORE_TYPES as readonly string[]).includes(v)
  );
}

function isFreeformKind(kind: WorkoutSessionKind): boolean {
  return (FREEFORM_SESSION_KINDS as readonly string[]).includes(kind);
}

async function sessionBelongsToGym(sessionId: string, communityId: string) {
  const [s] = await db
    .select({ id: workoutSessions.id })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.id, sessionId),
        eq(workoutSessions.communityId, communityId)
      )
    )
    .limit(1);
  return !!s;
}

function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

// Resolve (or create) the draft release covering the given date, so every
// programmed session lives inside a release. Mirrors the upsert the old
// route did against the legacy workouts table — releases themselves are
// unchanged by the cutover.
async function resolveDraftReleaseId(
  tx: typeof db,
  communityId: string,
  workoutDate: string
): Promise<string> {
  const monday = mondayOf(workoutDate);
  const [release] = await tx
    .select({ id: programmingReleases.id })
    .from(programmingReleases)
    .where(
      and(
        eq(programmingReleases.communityId, communityId),
        eq(programmingReleases.weekStart, monday)
      )
    )
    .limit(1);
  if (release) return release.id;
  const [created] = await tx
    .insert(programmingReleases)
    .values({
      communityId,
      weekStart: monday,
      status: "draft",
      source: "manual",
    })
    .returning({ id: programmingReleases.id });
  return created.id;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId } = await params;
  if (!(await canManageGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    // workoutDate is now the primary identifier — sections live on a
    // (community_id, workout_date) tuple in the unified schema. The legacy
    // `workoutId` field is no longer needed; we keep accepting it on the
    // wire to avoid breaking clients but ignore it server-side.
    workoutId?: string;
    workoutDate?: string;
    kind?: string;
    title?: string | null;
    body?: string | null;
    position?: number;
    isScored?: boolean;
    scoreType?: string | null;
    subKind?: string | null;
  } | null;
  if (!isValidKind(body?.kind)) {
    return NextResponse.json(
      { error: "A valid kind is required" },
      { status: 400 }
    );
  }
  if (!isValidScoreType(body?.scoreType ?? null)) {
    return NextResponse.json({ error: "Invalid scoreType" }, { status: 400 });
  }
  const workoutDate = body?.workoutDate;
  if (!workoutDate || !/^\d{4}-\d{2}-\d{2}$/.test(workoutDate)) {
    return NextResponse.json(
      { error: "workoutDate (YYYY-MM-DD) is required" },
      { status: 400 }
    );
  }

  const kind = body!.kind!;
  const freeform = isFreeformKind(kind);

  // Freeform kinds must carry a body — the DB CHECK enforces this but a
  // 400 here gives a friendlier message than the generic constraint
  // error. Structured kinds may be created empty (no body, no template);
  // an immediate content PUT supplies the prescription. Until the PUT
  // arrives we drop a placeholder body so the row clears the CHECK.
  if (freeform && !(body?.body && body.body.trim().length > 0)) {
    return NextResponse.json(
      { error: `${kind} sections require a body` },
      { status: 400 }
    );
  }
  const initialBody = freeform
    ? body!.body!
    : body?.body && body.body.trim().length > 0
      ? body.body
      : "(empty)";

  const result = await db.transaction(async (tx) => {
    const releaseId = await resolveDraftReleaseId(
      tx as unknown as typeof db,
      communityId,
      workoutDate
    );
    const position =
      body?.position !== undefined
        ? body.position
        : await nextPositionForDay(tx, { communityId, workoutDate });
    return createSession(tx, {
      crossfitWorkoutId: null,
      body: initialBody,
      kind,
      communityId,
      workoutDate,
      subKind: body!.subKind ?? null,
      position,
      title: body!.title ?? null,
      isScored: !!body!.isScored,
      scoreType:
        (body!.scoreType as WorkoutSessionScoreType | null | undefined) ??
        null,
      source: "manual",
      programmingReleaseId: releaseId,
      reviewedAt: new Date(),
    });
  });

  return NextResponse.json(result);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId } = await params;
  if (!(await canManageGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    id?: string;
    kind?: string;
    title?: string | null;
    body?: string | null;
    notes?: string | null;
    position?: number;
    isScored?: boolean;
    scoreType?: string | null;
    subKind?: string | null;
  } | null;
  if (!body?.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  if (!(await sessionBelongsToGym(body.id, communityId))) {
    return NextResponse.json(
      { error: "Section not found in this gym" },
      { status: 404 }
    );
  }

  // Spec mapping: legacy `workout_sections.notes` (coach-authored
  // section-specific guidance) is now `workout_sessions.coach_notes`. We
  // accept the legacy field name from clients during the transition; the
  // schema column is `coachNotes`.
  const patch: Record<string, unknown> = {
    reviewedAt: new Date(),
  };
  if (body.kind !== undefined) {
    if (!isValidKind(body.kind)) {
      return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
    }
    patch.kind = body.kind;
  }
  if (body.title !== undefined) patch.title = body.title;
  if (body.body !== undefined) patch.body = body.body;
  if (body.notes !== undefined) patch.coachNotes = body.notes;
  if (body.position !== undefined) patch.position = body.position;
  if (body.isScored !== undefined) patch.isScored = body.isScored;
  if (body.subKind !== undefined) patch.subKind = body.subKind;
  if (body.scoreType !== undefined) {
    if (!isValidScoreType(body.scoreType)) {
      return NextResponse.json({ error: "Invalid scoreType" }, { status: 400 });
    }
    patch.scoreType =
      (body.scoreType as WorkoutSessionScoreType | null) ?? null;
  }

  const updated = await db.transaction(async (tx) =>
    updateSession(tx, body.id!, patch)
  );
  return NextResponse.json(updated);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId } = await params;
  if (!(await canManageGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  if (!(await sessionBelongsToGym(id, communityId))) {
    return NextResponse.json({ ok: true });
  }

  // The session's scores cascade-delete via FK. The template stays
  // (intentional — other sessions may still reference it; orphan-clean
  // is deferred to a later commit).
  await db
    .delete(workoutSessions)
    .where(eq(workoutSessions.id, id));

  return NextResponse.json({ ok: true });
}
