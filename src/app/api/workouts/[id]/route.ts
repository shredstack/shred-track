import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { crossfitWorkouts, workoutSessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { getSessionAccess } from "@/lib/authz/workout";
import {
  upsertTemplate,
  type TemplatePartInput,
  type UpsertTemplateScope,
} from "@/lib/crossfit/upsert-template";
import { forkOrEditTemplate } from "@/lib/crossfit/fork-template";
import { updateSession } from "@/lib/crossfit/session-writer";
import { readSessionWorkouts } from "@/lib/crossfit/session-reader";
import { inngest } from "@/inngest/client";

// GET /api/workouts/[id] — day view. `id` is a workout_sessions.id, but
// the response is the whole day's grouped synthetic workout (every
// session sharing the requested session's scope + workout_date),
// mirroring the wire shape of GET /api/workouts. PUT/DELETE on this
// route stay session-level.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  const { id } = await params;

  // Anonymous reads are still supported (legacy behavior — public gym
  // pages embed this) but only return the workout when the caller has
  // read access. Authenticated callers must pass the same session-access
  // check we use for PUT/DELETE.
  if (user) {
    const access = await getSessionAccess(user.id, id);
    if (!access.exists) {
      return NextResponse.json({ error: "Workout not found" }, { status: 404 });
    }
    if (!access.canRead) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Resolve the requested session's scope + date so the reader can pull
  // every sibling session in the same day group.
  const [s] = await db
    .select({
      userId: workoutSessions.userId,
      communityId: workoutSessions.communityId,
      workoutDate: workoutSessions.workoutDate,
    })
    .from(workoutSessions)
    .where(eq(workoutSessions.id, id))
    .limit(1);
  if (!s) {
    return NextResponse.json({ error: "Workout not found" }, { status: 404 });
  }

  const result = await readSessionWorkouts({
    userId: user?.id ?? "",
    date: s.workoutDate,
    communityId: s.communityId ?? null,
    personalOnly: s.communityId == null,
    limit: 50,
  });

  const workout =
    result.find((w) => w.id === id) ??
    result.find((w) => w.sections.some((sec) => sec.id === id));
  if (!workout) {
    return NextResponse.json({ error: "Workout not found" }, { status: 404 });
  }

  return NextResponse.json(workout);
}

// In the unified schema the prescription lives on a template (not on a per-
// session row), so a "workout update" is one of two operations:
//   • Metadata-only PATCH — updates session-level fields (workoutDate,
//     published, kind, title-override, coachNotes). Template-level fields
//     (description, vest, partner, partnerCount) are intentionally NOT
//     mutable here; mutating them propagates through the fork-on-edit path
//     when the next `parts[]` PATCH lands.
//   • Prescription PATCH — routes through `forkOrEditTemplate` so a shared
//     template stays intact (a new template is forked off it; the original
//     keeps its scores). When the original is safe to mutate (no other
//     sessions and no scores), the helper edits in place. When the
//     original is a system template (Fran et al.), the route makes a
//     scoped fork in the session's scope instead — system rows are never
//     mutated. When the session had no template (freeform → structured),
//     a plain upsert kicks off.
type UpdatePartInput = TemplatePartInput;

// PUT /api/workouts/[id] — update a workout session and (when the
// prescription changes) the template it points at.
//
// `id` is a `workout_sessions.id`. There are two modes:
//   • parts[] omitted → metadata-only patch. Session-level fields
//     (workoutDate, published, kind, title-override, coachNotes) are
//     applied directly; template-level fields are intentionally NOT
//     mutated here (see the type comment above).
//   • parts[] provided → re-runs upsertTemplate with the new prescription.
//     The session is relinked to whatever template id the upsert resolves
//     (matched_existing OR new). Full fork-on-edit (with in-place edit
//     when the original template has no other sessions / scores) is
//     wired in commit #8.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const access = await getSessionAccess(user.id, id);
  if (!access.exists) {
    return NextResponse.json({ error: "Workout not found" }, { status: 404 });
  }
  if (!access.canEdit) {
    return NextResponse.json(
      { error: "You don't have permission to edit this workout" },
      { status: 403 }
    );
  }

  const [session] = await db
    .select()
    .from(workoutSessions)
    .where(eq(workoutSessions.id, id))
    .limit(1);
  if (!session) {
    return NextResponse.json({ error: "Workout not found" }, { status: 404 });
  }

  // Vest validation: if the resulting state has requiresVest=true, at
  // least one gendered vest weight must be set. Only enforced when the
  // caller is supplying parts (the body carries the new prescription).
  if (Array.isArray(body.parts) && body.requiresVest === true) {
    if (body.vestWeightMaleLb == null && body.vestWeightFemaleLb == null) {
      return NextResponse.json(
        { error: "Vest weight is required when requiresVest is true" },
        { status: 400 }
      );
    }
  }

  // ------------------------------------------------------------------
  // Metadata-only patch
  // ------------------------------------------------------------------
  if (!Array.isArray(body.parts)) {
    const sessionPatch: Record<string, unknown> = {};
    if (typeof body.workoutDate === "string" && body.workoutDate.trim()) {
      sessionPatch.workoutDate = body.workoutDate;
    }
    if (body.published !== undefined) {
      sessionPatch.published = !!body.published;
    }
    if (body.title !== undefined) {
      const trimmed =
        typeof body.title === "string" ? body.title.trim() : "";
      sessionPatch.title = trimmed.length > 0 ? trimmed : null;
    }
    if (body.coachNotes !== undefined) {
      const trimmed =
        typeof body.coachNotes === "string" ? body.coachNotes.trim() : "";
      sessionPatch.coachNotes = trimmed.length > 0 ? body.coachNotes : null;
    }

    if (Object.keys(sessionPatch).length === 0) {
      return NextResponse.json(session);
    }

    const updated = await db.transaction(async (tx) =>
      updateSession(tx, id, sessionPatch)
    );
    return NextResponse.json(updated);
  }

  // ------------------------------------------------------------------
  // Prescription patch — re-upsert the template, relink the session
  // ------------------------------------------------------------------
  const incomingParts = body.parts as UpdatePartInput[];
  if (incomingParts.length === 0) {
    return NextResponse.json(
      { error: "At least one part with movements is required" },
      { status: 400 }
    );
  }

  const firstPart = incomingParts[0];

  // Scope is determined by the session — personal sessions stay personal,
  // gym sessions stay gym-scoped. The session's owner / community drives
  // template scope so a personal edit can't accidentally write a community
  // template (and vice versa).
  const scope: UpsertTemplateScope = session.communityId
    ? { kind: "community", communityId: session.communityId }
    : session.userId
      ? { kind: "personal", userId: session.userId }
      : { kind: "system" };
  if (scope.kind === "system") {
    return NextResponse.json(
      { error: "System sessions cannot be edited here" },
      { status: 400 }
    );
  }

  const result = await db.transaction(async (tx) => {
    // Inherit the existing template's title/description when the patch
    // doesn't override them — same as the legacy `body.title ?? existing.title`
    // fallback. Pulled inside the tx so the read is consistent with the write.
    // Also pull `isSystem` so we can route around the fork helper's guard.
    const [currentTemplate] = session.crossfitWorkoutId
      ? await tx
          .select({
            title: crossfitWorkouts.title,
            description: crossfitWorkouts.description,
            isSystem: crossfitWorkouts.isSystem,
          })
          .from(crossfitWorkouts)
          .where(eq(crossfitWorkouts.id, session.crossfitWorkoutId))
          .limit(1)
      : [undefined];

    const nextTemplate = {
      title: deriveTitle(body.title, currentTemplate?.title, firstPart),
      description:
        body.description !== undefined
          ? body.description
          : currentTemplate?.description ?? null,
      scope,
      workoutType: firstPart.workoutType,
      timeCapSeconds: firstPart.timeCapSeconds ?? null,
      amrapDurationSeconds: firstPart.amrapDurationSeconds ?? null,
      repScheme: firstPart.repScheme ?? null,
      rounds: firstPart.rounds ?? null,
      requiresVest:
        body.requiresVest !== undefined ? !!body.requiresVest : undefined,
      vestWeightMaleLb:
        body.vestWeightMaleLb !== undefined ? body.vestWeightMaleLb : null,
      vestWeightFemaleLb:
        body.vestWeightFemaleLb !== undefined
          ? body.vestWeightFemaleLb
          : null,
      isPartner:
        body.isPartner !== undefined ? !!body.isPartner : undefined,
      partnerCount:
        body.partnerCount !== undefined ? body.partnerCount : null,
      parts: incomingParts,
    } as const;

    // Route by template state:
    //   • No current template (freeform → structured) → plain upsert.
    //   • Current template is system (Fran et al.) → scoped fork via
    //     upsertTemplate; the system row stays untouched.
    //   • Otherwise → forkOrEditTemplate, which matches an existing scope
    //     template by fingerprint OR edits in place when safe OR forks.
    type Mode = "matched_existing" | "edited_in_place" | "forked" | "upsert";
    let templateId: string;
    let isNew: boolean;
    let mode: Mode;
    if (!session.crossfitWorkoutId) {
      const r = await upsertTemplate(tx, nextTemplate);
      templateId = r.templateId;
      isNew = r.isNew;
      mode = "upsert";
    } else if (currentTemplate?.isSystem) {
      const r = await upsertTemplate(tx, nextTemplate);
      templateId = r.templateId;
      isNew = r.isNew;
      mode = "forked";
    } else {
      const r = await forkOrEditTemplate(tx, {
        originalTemplateId: session.crossfitWorkoutId,
        next: nextTemplate,
        triggeringSessionId: id,
      });
      templateId = r.templateId;
      isNew = r.isNew;
      mode = r.mode;
    }

    // Relink the session if the resolved template id differs.
    const sessionPatch: Record<string, unknown> = {};
    if (templateId !== session.crossfitWorkoutId) {
      sessionPatch.crossfitWorkoutId = templateId;
    }
    if (typeof body.workoutDate === "string" && body.workoutDate.trim()) {
      sessionPatch.workoutDate = body.workoutDate;
    }
    if (body.published !== undefined) {
      sessionPatch.published = !!body.published;
    }
    const updated =
      Object.keys(sessionPatch).length > 0
        ? await updateSession(tx, id, sessionPatch)
        : session;
    return {
      session: updated,
      crossfitWorkoutId: templateId,
      isNewTemplate: isNew,
      mode,
    };
  });

  // Re-fire the calorie compute against the (new or matched) template.
  try {
    await inngest.send({
      name: "workouts/calories.compute",
      data: { workoutId: result.crossfitWorkoutId },
    });
  } catch (err) {
    console.error("[calories] failed to dispatch compute event on PUT", err);
  }

  return NextResponse.json({
    ...result.session,
    crossfitWorkoutId: result.crossfitWorkoutId,
    isNewTemplate: result.isNewTemplate,
    templateWriteMode: result.mode,
  });
}

// Same title-derivation rule as POST: an explicit non-empty title wins,
// otherwise fall through to the current template title, then to the first
// part's label, then to a generic placeholder.
function deriveTitle(
  incomingTitle: unknown,
  fallbackTitle: string | undefined | null,
  firstPart: UpdatePartInput
): string {
  const candidate =
    typeof incomingTitle === "string" ? incomingTitle.trim() : "";
  if (candidate) return candidate;
  if (fallbackTitle && fallbackTitle.trim()) return fallbackTitle;
  const partLabel = firstPart.label?.trim();
  if (partLabel) return partLabel;
  return "Untitled workout";
}

// DELETE /api/workouts/[id] — delete the session. Cascade FKs handle the
// scores / score_movement_details / cross-domain references on the row;
// the template stays (it may have other sessions, scores, or be a system
// benchmark). The template orphan-clean is intentionally NOT done here in
// commit #5 — deletes a template only when it has no other sessions AND
// no scores belongs to a later commit so the cleanup logic gets its own
// review.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  // When called from the programming admin, the client passes
  // ?programmingOnly=1 so a wrong/stale id can't silently delete a manual
  // workout. Without this guard, the endpoint deletes any session the
  // caller can edit — including ad-hoc WODs sharing the same date.
  const programmingOnly =
    req.nextUrl.searchParams.get("programmingOnly") === "1";

  const access = await getSessionAccess(user.id, id);
  if (!access.exists) {
    return NextResponse.json({ error: "Workout not found" }, { status: 404 });
  }
  if (!access.canEdit) {
    return NextResponse.json(
      { error: "You don't have permission to delete this workout" },
      { status: 403 }
    );
  }

  if (programmingOnly) {
    const [row] = await db
      .select({
        programmingReleaseId: workoutSessions.programmingReleaseId,
      })
      .from(workoutSessions)
      .where(eq(workoutSessions.id, id))
      .limit(1);
    if (!row?.programmingReleaseId) {
      return NextResponse.json(
        { error: "Workout is not part of programming" },
        { status: 400 }
      );
    }
  }

  try {
    // The session's `scores` cascade-delete via FK; score_movement_details
    // rows attached to those scores go via THEIR cascade (the same FK
    // configuration as the legacy schema). class_instances /  gym_posts
    // FKs to workout_session_id are `on delete set null`, so they unhook
    // automatically. No explicit cleanup needed here.
    await db.transaction(async (tx) => {
      await tx.delete(workoutSessions).where(eq(workoutSessions.id, id));
    });

    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("DELETE /api/workouts/[id] failed", { sessionId: id, err });
    const message =
      err instanceof Error ? err.message : "Failed to delete workout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
