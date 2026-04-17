import Anthropic from "@anthropic-ai/sdk";
import { inngest } from "../client";
import { db } from "@/db";
import {
  hyroxTrainingPlans,
  hyroxPlanPhases,
  hyroxPlanSessions,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import type { AthleteSnapshot, AIWeekBatch, PlanPhase } from "@/types/hyrox-plan";
import { DIVISIONS, REFERENCE_TIMES, formatTime, formatLongTime } from "@/lib/hyrox-data";

const AI_MODEL = process.env.HYROX_TEST_MODE === "true"
  ? "claude-haiku-4-5-20251001"
  : "claude-sonnet-4-6-20250514";

function buildSystemPrompt(): string {
  return `You are an elite HYROX training coach regenerating a single week of a training plan. The athlete has requested changes to this specific week.

Key constraints:
- The athlete does CrossFit 5 days/week (Mon–Fri).
- Station skills are 5–10 minute add-ons AFTER CrossFit class (Mon, Wed, optionally Fri).
- Running sessions: Easy Run (Tue), Tempo/Race Pace Run (Thu), HYROX Day (Sat).
- Sunday is rest.
- Honor any equipment constraints or modifications the athlete has requested.

Respond with valid JSON only.`;
}

function buildAthleteContext(snapshot: AthleteSnapshot): string {
  const div = DIVISIONS[snapshot.division];
  const paceLabel = snapshot.paceUnit === "mile" ? "/mile" : "/km";

  let stationSummary = "";
  for (const a of snapshot.stationAssessments) {
    stationSummary += `- ${a.station}: Current ${formatTime(a.currentTimeSeconds ?? 0)}, Goal ${formatTime(a.goalTimeSeconds ?? 0)}, Confidence ${a.completionConfidence}/5\n`;
  }

  return `## Athlete
- ${snapshot.name}, ${div.label}
- Paces (${paceLabel}): Easy ${formatTime(snapshot.easyPaceSecondsPerUnit)}, Tempo ${formatTime(snapshot.moderatePaceSecondsPerUnit)}, Fast ${formatTime(snapshot.fastPaceSecondsPerUnit)}
- Available equipment: ${snapshot.availableEquipment.length > 0 ? snapshot.availableEquipment.join(", ") : "All"}
- Injuries: ${snapshot.injuriesNotes || "None"}
- Stations:\n${stationSummary}`;
}

export const regenerateWeek = inngest.createFunction(
  {
    id: "hyrox-regenerate-week",
    retries: 2,
    triggers: [{ event: "hyrox/week.regenerate" }],
  },
  async ({ event, step }: { event: { data: { planId: string; weekNumber: number; constraints: string; snapshot: AthleteSnapshot } }; step: any }) => {
    const { planId, weekNumber, constraints, snapshot } = event.data as {
      planId: string;
      weekNumber: number;
      constraints: string;
      snapshot: AthleteSnapshot;
    };

    // Get phase for this week
    const phase = await step.run("get-phase", async () => {
      const phases = await db
        .select()
        .from(hyroxPlanPhases)
        .where(eq(hyroxPlanPhases.planId, planId));

      return phases.find(
        (p) => weekNumber >= p.startWeek && weekNumber <= p.endWeek
      ) ?? null;
    });

    // Delete existing sessions for this week
    await step.run("delete-old-sessions", async () => {
      await db
        .delete(hyroxPlanSessions)
        .where(
          and(
            eq(hyroxPlanSessions.planId, planId),
            eq(hyroxPlanSessions.week, weekNumber)
          )
        );
    });

    // Generate new week
    await step.run("generate-week", async () => {
      const client = new Anthropic();
      const systemPrompt = buildSystemPrompt();
      const athleteContext = buildAthleteContext(snapshot);

      const prompt = `${athleteContext}

## Week Context
Week ${weekNumber}, Phase: ${phase?.name ?? "Unknown"} — ${phase?.description ?? ""}

## Athlete's Constraints for This Week
${constraints || "No special constraints — generate a standard week for this phase."}

## Weekly Structure
- Day 0 (Mon): Station Skills (5-10 min post-CF)
- Day 1 (Tue): Easy Run
- Day 2 (Wed): Station Skills (5-10 min post-CF)
- Day 3 (Thu): Tempo/Race Pace Run
- Day 4 (Fri): Rest or light station skills
- Day 5 (Sat): HYROX Day
- Day 6 (Sun): Rest

Generate the week with JSON matching this schema:
{
  "weeks": [
    {
      "weekNumber": ${weekNumber},
      "sessions": [
        {
          "dayOfWeek": "integer 0-6",
          "sessionType": "'station_skills' | 'run' | 'hyrox_day' | 'rest'",
          "title": "string",
          "description": "string",
          "targetPace": "string or null",
          "durationMinutes": "integer",
          "equipmentRequired": ["string"],
          "detail": {
            "warmup": "string or null",
            "blocks": [{ "label": "string", "movements": [{ "name": "string", "prescription": "string", "rest": "string or null", "notes": "string or null", "equipmentNeeded": "string or null" }] }],
            "cooldown": "string or null",
            "coachNotes": "string or null",
            "estimatedDuration": "integer"
          }
        }
      ]
    }
  ]
}`;

      const response = await client.messages.create({
        model: AI_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: prompt }],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("No text response from Claude");
      }

      const cleaned = textBlock.text.replace(/^```(?:json)?\n?/g, "").replace(/\n?```$/g, "").trim();
      const batch: AIWeekBatch = JSON.parse(cleaned);

      const sessionValues = batch.weeks.flatMap((week) =>
        week.sessions.map((session) => ({
          planId,
          week: week.weekNumber,
          dayOfWeek: session.dayOfWeek,
          sessionType: session.sessionType,
          title: session.title,
          description: session.description,
          targetPace: session.targetPace ?? null,
          durationMinutes: session.durationMinutes ?? null,
          phase: phase?.name ?? "Unknown",
          orderInDay: 1,
          phaseId: phase?.id ?? null,
          aiGenerated: true,
          athleteModified: false,
          sessionDetail: session.detail,
          equipmentRequired: session.equipmentRequired,
        }))
      );

      if (sessionValues.length > 0) {
        await db.insert(hyroxPlanSessions).values(sessionValues);
      }
    });

    return { planId, weekNumber, status: "regenerated" };
  }
);
