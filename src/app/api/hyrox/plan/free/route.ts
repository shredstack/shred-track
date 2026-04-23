// ---------------------------------------------------------------------------
// POST /api/hyrox/plan/free
//
// Creates a training plan from a pre-built generic template. No AI, no
// Inngest — pure DB copy. Target latency < 500ms.
//
// Request body:
//   {
//     gender:      "women" | "men",
//     raceFormat:  "singles" | "doubles" | "relay",
//     weightTier?: "open" | "pro",              // required for singles/doubles
//     paceTier:    "beginner" | "intermediate" | "advanced" | "elite",
//     raceDate:    string | null,                // ISO "YYYY-MM-DD" or null
//     disclaimerAccepted: boolean,               // must be true
//   }
//
// Responses:
//   200  { planId, generationStatus: "completed", totalWeeks, startDate, endDate }
//   400  invalid body / missing disclaimer
//   401  unauthenticated
//   404  template not found (shouldn't happen post-seed)
//   422  race_too_soon → surface paywall upsell
//   500  unexpected
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  hyroxGenericPlanTemplatePhases,
  hyroxGenericPlanTemplateSessions,
  hyroxGenericPlanTemplates,
  hyroxPlanPhases,
  hyroxPlanSessions,
  hyroxProfiles,
  hyroxTrainingPlans,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { resolvePlanDates } from "@/lib/hyrox-generic-plans/race-date";
import type { PaceSpec } from "@/types/hyrox-plan";
import { formatPaceSpec } from "@/lib/hyrox-data";

export const maxDuration = 30;

type Gender = "women" | "men";
type RaceFormat = "singles" | "doubles" | "relay";
type WeightTier = "open" | "pro";
type PaceTier = "beginner" | "intermediate" | "advanced" | "elite";

interface FreeFlowBody {
  gender: Gender;
  raceFormat: RaceFormat;
  weightTier?: WeightTier;
  paceTier: PaceTier;
  raceDate: string | null;
  disclaimerAccepted: boolean;
}

const VALID_GENDERS: Gender[] = ["women", "men"];
const VALID_FORMATS: RaceFormat[] = ["singles", "doubles", "relay"];
const VALID_WEIGHT_TIERS: WeightTier[] = ["open", "pro"];
const VALID_PACE_TIERS: PaceTier[] = ["beginner", "intermediate", "advanced", "elite"];

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ---- Parse + validate body ------------------------------------------------
  let body: Partial<FreeFlowBody>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.disclaimerAccepted) {
    return NextResponse.json(
      { error: "You must accept the training disclaimer to continue." },
      { status: 400 },
    );
  }
  if (!body.gender || !VALID_GENDERS.includes(body.gender)) {
    return NextResponse.json({ error: "Invalid gender" }, { status: 400 });
  }
  if (!body.raceFormat || !VALID_FORMATS.includes(body.raceFormat)) {
    return NextResponse.json({ error: "Invalid raceFormat" }, { status: 400 });
  }
  if (!body.paceTier || !VALID_PACE_TIERS.includes(body.paceTier)) {
    return NextResponse.json({ error: "Invalid paceTier" }, { status: 400 });
  }
  // Relay is open-only; singles/doubles require an explicit weight tier.
  const weightTier: WeightTier =
    body.raceFormat === "relay"
      ? "open"
      : body.weightTier && VALID_WEIGHT_TIERS.includes(body.weightTier)
        ? body.weightTier
        : (undefined as unknown as WeightTier);
  if (body.raceFormat !== "relay" && !weightTier) {
    return NextResponse.json({ error: "Missing weightTier for singles/doubles" }, { status: 400 });
  }

  // raceDate must be null or ISO "YYYY-MM-DD"
  if (body.raceDate !== null && typeof body.raceDate !== "string") {
    return NextResponse.json({ error: "Invalid raceDate" }, { status: 400 });
  }
  if (body.raceDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.raceDate)) {
    return NextResponse.json({ error: "raceDate must be YYYY-MM-DD" }, { status: 400 });
  }

  // ---- Compute dates --------------------------------------------------------
  const dateResult = resolvePlanDates(body.raceDate ?? null);
  if (!dateResult.ok) {
    if (dateResult.problem.kind === "race_too_soon") {
      return NextResponse.json(
        {
          error: "race_too_soon",
          weeksUntilRace: dateResult.problem.weeksUntilRace,
          message:
            "Your race is less than 14 weeks away. A generic plan wouldn't serve you well at this point — upgrade to personalized for a compressed, race-specific program.",
        },
        { status: 422 },
      );
    }
  }
  const resolution = (dateResult as { ok: true; resolution: Awaited<ReturnType<typeof resolvePlanDates>> extends { ok: true; resolution: infer R } ? R : never }).resolution;
  const { startTemplateWeek, totalWeeks, startDate, endDate } = resolution;

  // ---- Look up template -----------------------------------------------------
  const templateKey = `${body.gender}_${body.raceFormat}_${body.paceTier}`;
  const [template] = await db
    .select()
    .from(hyroxGenericPlanTemplates)
    .where(
      and(
        eq(hyroxGenericPlanTemplates.templateKey, templateKey),
        eq(hyroxGenericPlanTemplates.weightTier, weightTier),
      ),
    )
    .limit(1);

  if (!template) {
    return NextResponse.json(
      { error: `Template ${templateKey} (${weightTier}) not found. Run db:seed:hyrox-generic-plans.` },
      { status: 404 },
    );
  }

  // Fetch phases + sessions filtered by start_template_week.
  const templatePhases = await db
    .select()
    .from(hyroxGenericPlanTemplatePhases)
    .where(eq(hyroxGenericPlanTemplatePhases.templateId, template.id))
    .orderBy(asc(hyroxGenericPlanTemplatePhases.phaseNumber));

  const templateSessions = await db
    .select()
    .from(hyroxGenericPlanTemplateSessions)
    .where(eq(hyroxGenericPlanTemplateSessions.templateId, template.id))
    .orderBy(
      asc(hyroxGenericPlanTemplateSessions.week),
      asc(hyroxGenericPlanTemplateSessions.dayOfWeek),
      asc(hyroxGenericPlanTemplateSessions.orderInDay),
    );

  // Filter phases/sessions to only those at or after startTemplateWeek.
  const includedPhases = templatePhases.filter((p) => p.endWeek >= startTemplateWeek);
  const includedSessions = templateSessions.filter((s) => s.week >= startTemplateWeek);

  // ---- Compute target_division ---------------------------------------------
  const targetDivision = deriveTargetDivision(body.gender, body.raceFormat, weightTier);

  // ---- Run the DB writes ---------------------------------------------------
  // Upsert profile, archive active plans, insert plan + phases + sessions.
  // Wrapped in a single transaction so a mid-flight failure doesn't leave
  // half-copied state behind.
  const planId = await db.transaction(async (tx) => {
    // Upsert profile: if one exists, patch the free-flow fields; otherwise insert.
    const [existingProfile] = await tx
      .select()
      .from(hyroxProfiles)
      .where(eq(hyroxProfiles.userId, user.id))
      .limit(1);

    if (existingProfile) {
      await tx
        .update(hyroxProfiles)
        .set({
          gender: body.gender,
          targetDivision,
          paceTier: body.paceTier,
          planTier: "free",
          disclaimerAcceptedAt: new Date(),
          nextRaceDate: body.raceDate ?? null,
          updatedAt: new Date(),
        })
        .where(eq(hyroxProfiles.id, existingProfile.id));
    } else {
      await tx.insert(hyroxProfiles).values({
        userId: user.id,
        name: user.name,
        gender: body.gender,
        targetDivision,
        paceTier: body.paceTier,
        planTier: "free",
        disclaimerAcceptedAt: new Date(),
        nextRaceDate: body.raceDate ?? null,
        onboardingVersion: 1,
        paceUnit: "mile",
      });
    }

    // Archive existing active plans.
    await tx
      .update(hyroxTrainingPlans)
      .set({ status: "archived" })
      .where(
        and(
          eq(hyroxTrainingPlans.userId, user.id),
          eq(hyroxTrainingPlans.status, "active"),
        ),
      );

    // Insert the plan row.
    const [plan] = await tx
      .insert(hyroxTrainingPlans)
      .values({
        userId: user.id,
        title: template.title,
        totalWeeks,
        startDate,
        endDate,
        planType: "generic",
        status: "active",
        paceScaleFactor: "1.0",
        generationStatus: "completed",
        trainingPhilosophy: { summary: template.trainingPhilosophy, templateVersion: template.version },
        athleteSnapshot: null,
      })
      .returning({ id: hyroxTrainingPlans.id });

    // Insert phases (renumbering weeks to the user plan's 1-based weeks).
    const insertedPhases = await tx
      .insert(hyroxPlanPhases)
      .values(
        includedPhases.map((p) => ({
          planId: plan.id,
          phaseNumber: p.phaseNumber,
          name: p.name,
          description: p.description,
          startWeek: Math.max(1, p.startWeek - startTemplateWeek + 1),
          endWeek: p.endWeek - startTemplateWeek + 1,
          focusAreas: p.focusAreas,
        })),
      )
      .returning({ id: hyroxPlanPhases.id, phaseNumber: hyroxPlanPhases.phaseNumber });

    const phaseIdByNumber = new Map<number, string>(
      insertedPhases.map((p) => [p.phaseNumber, p.id]),
    );

    // Insert sessions (in chunks of 200 to stay well under Postgres limits).
    const sessionRows = includedSessions.map((s) => {
      const week = s.week - startTemplateWeek + 1;
      const phaseLabel = phaseLabelFor(s.phaseNumber);
      const targetPace = paceSpecToDisplayString(s.paceSpec as PaceSpec | null);
      return {
        planId: plan.id,
        week,
        dayOfWeek: s.dayOfWeek,
        sessionType: s.sessionType,
        title: s.title,
        description: s.description,
        targetPace,
        durationMinutes: s.durationMinutes,
        phase: phaseLabel,
        orderInDay: s.orderInDay,
        phaseId: phaseIdByNumber.get(s.phaseNumber) ?? null,
        aiGenerated: false,
        athleteModified: false,
        originalSessionData: null,
        sessionDetail: s.sessionDetail,
        equipmentRequired: s.equipmentRequired,
      };
    });

    for (const batch of chunk(sessionRows, 200)) {
      await tx.insert(hyroxPlanSessions).values(batch);
    }

    return plan.id;
  });

  return NextResponse.json(
    {
      planId,
      generationStatus: "completed",
      totalWeeks,
      startDate,
      endDate,
    },
    { status: 201 },
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveTargetDivision(gender: Gender, format: RaceFormat, weightTier: WeightTier): string {
  if (format === "singles") return `${gender}_${weightTier}`;
  if (format === "doubles") return `doubles_${gender}_${weightTier}`;
  return `relay_${gender}`;
}

/**
 * For the legacy string-based `target_pace` column on hyrox_plan_sessions,
 * produce a reasonable human-readable default. Sessions render via
 * session_detail → formatMovementPrescription (unit-aware) anyway; this
 * string is just a display hint on the plan card.
 */
function paceSpecToDisplayString(spec: PaceSpec | null): string | null {
  if (!spec) return null;
  return formatPaceSpec(spec, "mi");
}

function phaseLabelFor(phaseNumber: number): string {
  // Matches the phase names used by the AI-generated plans so plan-view-v2
  // groups them the same way.
  switch (phaseNumber) {
    case 1: return "Foundation";
    case 2: return "Base Building";
    case 3: return "Aerobic Development";
    case 4: return "Threshold Push";
    case 5: return "Race Specificity";
    case 6: return "Peak & Taper";
    default: return `Phase ${phaseNumber}`;
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
