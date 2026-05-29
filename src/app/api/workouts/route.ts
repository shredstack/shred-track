import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { crossfitWorkouts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { canCreateWorkoutInGym } from "@/lib/authz/workout";
import { canViewGym } from "@/lib/authz/community";
import type { WorkoutType } from "@/types/crossfit";
import {
  upsertTemplate,
  type TemplatePartInput,
  type TemplatePartMovementInput,
  type UpsertTemplateScope,
} from "@/lib/crossfit/upsert-template";
import { createSession } from "@/lib/crossfit/session-writer";
import { inferWeightliftingBenchmark } from "@/lib/crossfit/weightlifting-benchmarks";
import { readSessionWorkouts } from "@/lib/crossfit/session-reader";
import { inngest } from "@/inngest/client";

// ============================================
// Request body shape
// ============================================
//
// The `parts[]` shape (and its movement/block sub-shapes) is the same as
// `TemplatePartInput` from `@/lib/crossfit/upsert-template` — see that
// module for the canonical type definitions. We re-export the input alias
// here so the legacy flat-shape normalizer below can name it.
type PartInput = TemplatePartInput;

// GET /api/workouts — list workouts.
// Supports filters:
//   ?communityId=<uuid>     — gym programming view: visible to all active
//                             members of that gym (not just the creator).
//   ?personal=1             — explicit personal-only view (createdBy=me AND
//                             communityId IS NULL).
//   ?date=YYYY-MM-DD        — exact match on workoutDate
//   ?startDate=YYYY-MM-DD   — workoutDate >=
//   ?endDate=YYYY-MM-DD     — workoutDate <=
//   ?movementId=<uuid>      — only workouts containing this movement
//   ?q=<text>               — case-insensitive search over title/description/rawText
// With no scope filter we return everything the caller can read: their
// personal workouts plus gym workouts from any gym they're an active
// member of. Returns each workout with its nested parts, movements, and
// (for the caller's own workouts) per-part scores + movement details.
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const communityId = params.get("communityId");
  const personal = params.get("personal");
  const date = params.get("date");
  const startDate = params.get("startDate");
  const endDate = params.get("endDate");
  const movementId = params.get("movementId");
  const q = params.get("q")?.trim();

  // Gym programming view: membership check before the query so a
  // non-member can't read a gym's WODs by guessing the id.
  if (communityId) {
    const ok = await canViewGym(user.id, communityId);
    if (!ok)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Search requests return more results so the user can scan history; the
  // day-view path stays at 50 since a single date rarely has more.
  const isSearch = !!(startDate || endDate || movementId || q);

  const result = await readSessionWorkouts({
    userId: user.id,
    communityId: communityId ?? undefined,
    personalOnly: personal === "1" || personal === "true",
    date: date ?? undefined,
    startDate: startDate ?? undefined,
    endDate: endDate ?? undefined,
    movementId: movementId ?? undefined,
    q: q || undefined,
    limit: isSearch ? 100 : 50,
  });

  return NextResponse.json(result);
}

// POST /api/workouts — create a workout (session + template) on the
// unified-schema tables. Every path here ends in:
//   1. An `upsertTemplate` call that resolves a `crossfit_workouts` row
//      (deduped by content fingerprint within scope), or a direct lookup of
//      an existing benchmark template.
//   2. A `createSession` call that produces a `workout_sessions` row
//      pointing at that template (kind = 'wod', position = 0).
//
// Body shapes accepted (all-or-nothing per request):
//   • Benchmark fast-path:        { benchmarkWorkoutId, workoutDate, communityId? }
//                                  benchmarkWorkoutId is a crossfit_workouts.id
//                                  with is_benchmark = true.
//   • Smart Builder (parts[]):    { parts: [...], title, description?, ... }
//   • Weightlifting attempt:      Falls through the parts path; the auto-link
//                                  inference routes the session at the
//                                  canonical weightlifting template when the
//                                  prescription qualifies.
//
// Response: the new `workout_sessions` row, augmented with `crossfitWorkoutId`
// + `isNewTemplate`. The `id` field is the session id — that's the same handle
// the GET / DELETE endpoints will use post-cutover.
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const {
    title,
    description,
    workoutDate,
    communityId,
    published,
    source,
    benchmarkWorkoutId,
    requiresVest,
    vestWeightMaleLb,
    vestWeightFemaleLb,
    isPartner,
    partnerCount,
  } = body;

  // Gym-workout authorization: only coaches/admins of the target gym can
  // create gym programming. Personal workouts (communityId omitted/null)
  // are always allowed.
  const targetCommunityId =
    typeof communityId === "string" && communityId.length > 0
      ? communityId
      : null;
  if (targetCommunityId) {
    const ok = await canCreateWorkoutInGym(user.id, targetCommunityId);
    if (!ok)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Vest validation: if the workout claims it requires a vest, at least
  // one of the gendered weights must be set. We won't trust a "true"
  // toggle with no weight on either side.
  if (requiresVest === true) {
    if (
      vestWeightMaleLb == null &&
      vestWeightFemaleLb == null
    ) {
      return NextResponse.json(
        { error: "Vest weight is required when requiresVest is true" },
        { status: 400 }
      );
    }
  }

  if (!workoutDate) {
    return NextResponse.json(
      { error: "workoutDate is required" },
      { status: 400 }
    );
  }

  const scope: UpsertTemplateScope = targetCommunityId
    ? { kind: "community", communityId: targetCommunityId }
    : { kind: "personal", userId: user.id };

  // ============================================
  // Benchmark fast-path — session points directly at the canonical template
  // ============================================
  //
  // The benchmarkWorkoutId in the request body is a `crossfit_workouts.id`
  // with `is_benchmark = true`. We don't copy parts/movements — sessions
  // share the template. The override fields (`isPartner`, `requiresVest`,
  // etc.) on the body are ignored here; in the unified schema those live
  // on the template, so changing them would either mutate the canonical
  // template (bad) or require a fork (deferred to commit #8). The picker
  // already surfaces the canonical metadata, so an athlete picking Murph
  // gets Murph's vest config without having to re-send it.

  if (benchmarkWorkoutId) {
    const [tmpl] = await db
      .select({
        id: crossfitWorkouts.id,
        isBenchmark: crossfitWorkouts.isBenchmark,
        weightliftingMovementId: crossfitWorkouts.weightliftingMovementId,
      })
      .from(crossfitWorkouts)
      .where(eq(crossfitWorkouts.id, benchmarkWorkoutId))
      .limit(1);

    if (!tmpl) {
      return NextResponse.json(
        { error: "Benchmark not found" },
        { status: 404 }
      );
    }
    if (!tmpl.isBenchmark) {
      return NextResponse.json(
        { error: "Template is not a benchmark" },
        { status: 400 }
      );
    }

    // Weightlifting benchmarks are stat-tracker anchors, not workouts to
    // pick directly — when the client supplies `parts` alongside a
    // weightlifting benchmark id, the user's typed rep/weight is the
    // prescription. Fall through to the parts path; the auto-link
    // inference there relinks the session to this canonical template.
    const hasParts =
      Array.isArray(body.parts) && (body.parts as unknown[]).length > 0;
    if (!(tmpl.weightliftingMovementId && hasParts)) {
      const session = await db.transaction(async (tx) => {
        return createSession(tx, {
          crossfitWorkoutId: tmpl.id,
          userId: targetCommunityId ? null : user.id,
          communityId: targetCommunityId,
          workoutDate,
          // 'wod' is the gym-programmed-section taxonomy; on a personal
          // log it's noise that pollutes downstream analytics and forces
          // the synthetic-workout reader's owner-section logic. Personal
          // adds default to 'custom' so 'wod' unambiguously means a
          // gym-programmed WOD section.
          kind: targetCommunityId ? "wod" : "custom",
          position: 0,
          isScored: true,
          source: source || "benchmark",
          published: published ?? targetCommunityId !== null,
        });
      });

      await fireCalorieEstimate(tmpl.id);
      return NextResponse.json(
        { ...session, crossfitWorkoutId: tmpl.id, isNewTemplate: false },
        { status: 201 }
      );
    }
  }

  // ============================================
  // Parts path — upsert a template, then create a session pointing at it
  // ============================================

  const parts: PartInput[] = normalizeParts(body);

  if (parts.length === 0) {
    return NextResponse.json(
      { error: "At least one part with movements is required" },
      { status: 400 }
    );
  }

  const firstPart = parts[0];

  // Weightlifting auto-link: detect the qualifying shape BEFORE upserting
  // so the session lands directly on the canonical benchmark template (no
  // orphan personal template). Skipped when the caller supplied an explicit
  // `source` — that signals user intent that overrides inference.
  let autoLinkedTemplateId: string | null = null;
  if (!source && !benchmarkWorkoutId) {
    const autoLink = await inferWeightliftingBenchmark(
      db,
      parts.map((p) => ({
        workoutType: p.workoutType,
        repScheme: p.repScheme ?? null,
        movementIds: p.movements.map((m) => m.movementId),
        movementPrescribedReps: p.movements.map((m) => m.prescribedReps ?? null),
      }))
    );
    if (autoLink) autoLinkedTemplateId = autoLink.templateId;
  }

  let result: {
    session: Awaited<ReturnType<typeof createSession>>;
    templateId: string;
    isNewTemplate: boolean;
  };
  try {
    result = await db.transaction(async (tx) => {
      let templateId: string;
      let isNewTemplate = false;

      if (autoLinkedTemplateId) {
        // Reuse the canonical weightlifting benchmark template — the
        // athlete's actual weight will live on the score, not the template.
        templateId = autoLinkedTemplateId;
      } else {
        const upsertResult = await upsertTemplate(tx, {
          title: deriveTitle(title, firstPart),
          description: description ?? null,
          scope,
          workoutType: firstPart.workoutType,
          timeCapSeconds: firstPart.timeCapSeconds ?? null,
          amrapDurationSeconds: firstPart.amrapDurationSeconds ?? null,
          repScheme: firstPart.repScheme ?? null,
          rounds: firstPart.rounds ?? null,
          requiresVest: !!requiresVest,
          vestWeightMaleLb: vestWeightMaleLb ?? null,
          vestWeightFemaleLb: vestWeightFemaleLb ?? null,
          isPartner: !!isPartner,
          partnerCount: partnerCount ?? null,
          parts,
        });
        templateId = upsertResult.templateId;
        isNewTemplate = upsertResult.isNew;
      }

      const session = await createSession(tx, {
        crossfitWorkoutId: templateId,
        userId: targetCommunityId ? null : user.id,
        communityId: targetCommunityId,
        workoutDate,
        // See benchmark fast-path above for the kind default rationale.
        kind: targetCommunityId ? "wod" : "custom",
        position: 0,
        isScored: true,
        source:
          source || (autoLinkedTemplateId ? "benchmark_inferred" : "manual"),
        published: published ?? targetCommunityId !== null,
      });

      return { session, templateId, isNewTemplate };
    });
  } catch (err) {
    // Surface validation errors thrown from upsertTemplate /
    // insertTemplateParts so the Smart Builder can show the user exactly
    // what's missing (e.g. intervals work/rest cadence) instead of a
    // generic "Failed to save".
    const message =
      err instanceof Error && err.message ? err.message : "Failed to save";
    console.error("[api/workouts] POST failed", err);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  await fireCalorieEstimate(result.templateId);
  return NextResponse.json(
    {
      ...result.session,
      crossfitWorkoutId: result.templateId,
      isNewTemplate: result.isNewTemplate,
    },
    { status: 201 }
  );
}

// Pick a non-empty title for the template. Templates require a NOT NULL
// title; if the client didn't send one, fall back to the first part's label
// or a generic placeholder so the row writes successfully. Cosmetic only —
// excluded from the content fingerprint, so the title choice never affects
// dedup behavior.
function deriveTitle(
  title: unknown,
  firstPart: TemplatePartInput
): string {
  const candidate = typeof title === "string" ? title.trim() : "";
  if (candidate) return candidate;
  const partLabel = firstPart.label?.trim();
  if (partLabel) return partLabel;
  return "Untitled workout";
}

// Fire-and-forget Inngest event so the template-level calorie estimate is
// computed asynchronously. Failing to send must not break the workout
// creation — the estimate can always be backfilled later. The event data
// key stays `workoutId` for now to avoid breaking pending Inngest payloads;
// the value is a `crossfit_workouts.id` post-cutover, and the compute
// function will be updated to read from the unified schema in commit #6.
async function fireCalorieEstimate(crossfitWorkoutId: string): Promise<void> {
  try {
    await inngest.send({
      name: "workouts/calories.compute",
      data: { workoutId: crossfitWorkoutId },
    });
  } catch (err) {
    console.error("[calories] failed to dispatch compute event", err);
  }
}

// ============================================
// Accept parts[] or legacy flat shape.
// ============================================

function normalizeParts(body: Record<string, unknown>): PartInput[] {
  if (Array.isArray(body.parts)) {
    return (body.parts as PartInput[]).filter(
      (p) => p?.workoutType && Array.isArray(p.movements)
    );
  }

  // Legacy: flat { workoutType, movements, ... }. Wrapped into a single
  // part. The duration/numeric coercions land later inside `upsertTemplate`
  // — we just shuttle the raw inputs through here.
  if (body.workoutType && Array.isArray(body.movements)) {
    return [
      {
        workoutType: body.workoutType as WorkoutType,
        timeCapSeconds: body.timeCapSeconds as number | undefined,
        amrapDurationSeconds: body.amrapDurationSeconds as number | undefined,
        repScheme: body.repScheme as string | undefined,
        rounds: body.rounds as number | undefined,
        movements: body.movements as TemplatePartMovementInput[],
      },
    ];
  }

  return [];
}

