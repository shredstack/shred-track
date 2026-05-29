// POST /api/gym/[id]/programming/cap-paste
//
// Takes raw CAP-style text, parses it via lib/cap-parser, and creates (or
// upserts) a draft release for the week along with one workout_sessions
// row per parsed (day, section). Coach/admin only.
//
// In the unified schema there is no `workouts` container; each parsed
// section directly maps to a workout_sessions row. CAP-paste re-runs are
// idempotent by (community_id, workout_date, position): sessions with
// `reviewed_at` set are preserved (the coach customized them); sessions
// without are replaced by the new paste. This mirrors the legacy
// per-section re-paste guard, just on the unified table.

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  FREEFORM_SESSION_KINDS,
  WORKOUT_SESSION_KINDS,
  programmingReleases,
  workoutSessions,
  type WorkoutSessionKind,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";
import { isFlagOn } from "@/lib/feature-flags";
import { parseCapPaste } from "@/lib/cap-parser";
import { createSession } from "@/lib/crossfit/session-writer";

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function normalizeKind(kind: string): WorkoutSessionKind {
  if ((WORKOUT_SESSION_KINDS as readonly string[]).includes(kind)) {
    return kind as WorkoutSessionKind;
  }
  // CAP parser may emit kinds outside the canonical session kind set
  // (e.g. legacy section kinds). Fall back to `custom` so the row clears
  // the DB CHECK constraint. The coach can re-kind it in admin.
  return "custom";
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

  if (!(await isFlagOn("cap_paste_import", { userId: user.id, communityId }))) {
    return NextResponse.json(
      { error: "CAP paste import is disabled for this gym" },
      { status: 403 }
    );
  }

  const body = (await req.json().catch(() => null)) as {
    weekStart?: string;
    text?: string;
  } | null;
  if (!body?.weekStart || !isIsoDate(body.weekStart)) {
    return NextResponse.json(
      { error: "weekStart (YYYY-MM-DD) is required" },
      { status: 400 }
    );
  }
  if (!body.text || body.text.trim().length === 0) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const parsed = parseCapPaste(body.text);
  if (parsed.days.length === 0) {
    return NextResponse.json(
      { error: "Couldn't find any day headers in the pasted text" },
      { status: 400 }
    );
  }

  const result = await db.transaction(async (tx) => {
    // Upsert the release for the week.
    const [existingRelease] = await tx
      .select({ id: programmingReleases.id })
      .from(programmingReleases)
      .where(
        and(
          eq(programmingReleases.communityId, communityId),
          eq(programmingReleases.weekStart, body.weekStart!)
        )
      )
      .limit(1);

    let releaseId: string;
    if (existingRelease) {
      releaseId = existingRelease.id;
      await tx
        .update(programmingReleases)
        .set({
          source: "cap_paste",
          sourceMeta: { rawText: body.text },
          updatedAt: new Date(),
        })
        .where(eq(programmingReleases.id, releaseId));
    } else {
      const [created] = await tx
        .insert(programmingReleases)
        .values({
          communityId,
          weekStart: body.weekStart!,
          status: "draft",
          source: "cap_paste",
          sourceMeta: { rawText: body.text },
        })
        .returning({ id: programmingReleases.id });
      releaseId = created.id;
    }

    let totalSessions = 0;
    for (const day of parsed.days) {
      const workoutDate = addDays(body.weekStart!, day.dayIndex);

      // Reviewed sessions on this day stay (the coach customized them);
      // unreviewed sessions are dropped and re-created from the paste.
      const dayExisting = await tx
        .select({
          id: workoutSessions.id,
          kind: workoutSessions.kind,
          reviewedAt: workoutSessions.reviewedAt,
        })
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.communityId, communityId),
            eq(workoutSessions.workoutDate, workoutDate)
          )
        );

      const reviewedKinds = new Set(
        dayExisting
          .filter((s) => !!s.reviewedAt)
          .map((s) => s.kind)
      );
      const dropIds = dayExisting
        .filter((s) => !s.reviewedAt)
        .map((s) => s.id);
      if (dropIds.length > 0) {
        await tx
          .delete(workoutSessions)
          .where(inArray(workoutSessions.id, dropIds));
      }

      let position = reviewedKinds.size; // append after preserved sessions
      for (const section of day.sections) {
        if (reviewedKinds.has(section.kind)) continue;

        const kind = normalizeKind(section.kind);
        const isFreeform = (FREEFORM_SESSION_KINDS as readonly string[]).includes(
          kind
        );
        const trimmedBody = section.body?.trim() ?? "";
        // Freeform kinds need a body; for structured kinds the body is
        // the placeholder until a coach swaps the section into Smart
        // Builder. The unified CHECK requires one or the other.
        const bodyText =
          isFreeform && trimmedBody.length === 0
            ? "(empty)"
            : trimmedBody.length > 0
              ? section.body
              : "(empty)";

        await createSession(tx, {
          crossfitWorkoutId: null,
          body: bodyText,
          communityId,
          workoutDate,
          kind,
          position,
          title: section.title ?? null,
          isScored: section.isScored,
          scoreType: section.scoreType ?? null,
          source: "parsed",
          programmingReleaseId: releaseId,
        });
        position += 1;
        totalSessions += 1;
      }
    }

    return { releaseId, days: parsed.days.length, sessions: totalSessions };
  });

  return NextResponse.json(result);
}

