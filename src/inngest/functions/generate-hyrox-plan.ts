import Anthropic from "@anthropic-ai/sdk";
import { inngest } from "../client";
import { db } from "@/db";
import {
  hyroxTrainingPlans,
  hyroxPlanPhases,
  hyroxPlanSessions,
  hyroxRaceScenarios,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import type {
  AthleteSnapshot,
  AIPlanOverview,
  AIWeekBatch,
  RaceScenario,
  PlanPhase,
} from "@/types/hyrox-plan";
import {
  DIVISIONS,
  REFERENCE_TIMES,
  STATION_ORDER,
  formatTime,
  formatLongTime,
} from "@/lib/hyrox-data";

const AI_MODEL = process.env.HYROX_TEST_MODE === "true"
  ? "claude-haiku-4-5-20251001"
  : "claude-sonnet-4-6";

function buildSystemPrompt(): string {
  return `You are an elite HYROX training coach creating personalized training plans. You understand periodization, running physiology, and HYROX race strategy deeply.

Key constraints for every plan:
- The athlete does CrossFit 5 days/week (Mon–Fri). CrossFit sessions are NOT part of the HYROX plan — they happen independently at the athlete's gym.
- Station skills are 5–10 minute add-ons AFTER CrossFit class (Mon, Wed, and optionally Fri). They are NOT standalone sessions.
- Running sessions are separate from CrossFit: Easy Run (Tue), Tempo/Race Pace Run (Thu), HYROX Day (Sat).
- Saturday is the dedicated longer HYROX training day with intervals + station work (45-90 min).
- Sunday is always rest/active recovery.
- The 80/20 rule: 80% of running volume should be easy (conversational pace). Only 20% is quality work.
- Progressive overload: distances, paces, and station times all progress through phases.
- Station skills should rotate through all 8 stations every 2 weeks, with extra attention to the athlete's weakest stations.
- In later phases, include full and half race simulations on Saturdays.
- Taper properly in the final 2-4 weeks: reduce volume, maintain intensity, keep station patterns fresh.

Always respond with valid JSON matching the requested schema. No markdown, no explanation — just the JSON object.`;
}

function buildAthleteContext(snapshot: AthleteSnapshot): string {
  const div = DIVISIONS[snapshot.division];
  const refs = REFERENCE_TIMES[snapshot.division];

  let stationSummary = "";
  for (const assessment of snapshot.stationAssessments) {
    const station = assessment.station as (typeof STATION_ORDER)[number];
    const ref = refs?.[station] ?? [240, 300, 420];
    stationSummary += `- ${station}: Current ${formatTime(assessment.currentTimeSeconds ?? ref[1])}, Goal ${formatTime(assessment.goalTimeSeconds ?? ref[0])}, Confidence ${assessment.completionConfidence}/5\n`;
  }

  const paceLabel = snapshot.paceUnit === "mile" ? "/mile" : "/km";

  return `## Athlete Profile
- Name: ${snapshot.name}
- Gender: ${snapshot.gender}, Division: ${div.label}
- Race date: ${snapshot.raceDate ?? "No specific race — use 12-week general prep"}
- Goal finish time: ${snapshot.goalFinishTimeSeconds ? formatLongTime(snapshot.goalFinishTimeSeconds) : "Not specified — optimize for maximum improvement"}
- Training philosophy: ${snapshot.trainingPhilosophy} (conservative = cautious volume ramp, moderate = standard progression, aggressive = higher volume/intensity)

## Running Paces (${paceLabel})
- Easy: ${formatTime(snapshot.easyPaceSecondsPerUnit)}
- Moderate/Tempo: ${formatTime(snapshot.moderatePaceSecondsPerUnit)}
- Fast/Interval: ${formatTime(snapshot.fastPaceSecondsPerUnit)}

## Race Experience
- Previous races: ${snapshot.previousRaceCount}
- Best finish: ${snapshot.bestFinishTimeSeconds ? formatLongTime(snapshot.bestFinishTimeSeconds) : "N/A"}

## CrossFit Schedule
- ${snapshot.crossfitDaysPerWeek} days/week${snapshot.crossfitGymName ? ` at ${snapshot.crossfitGymName}` : ""}
- Available equipment: ${snapshot.availableEquipment.length > 0 ? snapshot.availableEquipment.join(", ") : "All standard HYROX equipment"}

## Injuries/Limitations
${snapshot.injuriesNotes || "None reported"}

## Station Assessments
${stationSummary}

## Division Station Specs
${div.stations.map((s) => `- ${s.name}: ${s.distance ?? `${s.reps} reps`}${s.weightLabel ? ` @ ${s.weightLabel}` : ""}`).join("\n")}`;
}

function planOverviewSchema(): string {
  return `{
  "title": "string — plan title, e.g. 'HYROX Sub-60 24-Week Plan'",
  "trainingPhilosophy": "string — 2-3 paragraph summary of the training approach, how it builds on the athlete's strengths, and what the key focus areas are",
  "phases": [
    {
      "phaseNumber": "integer — 1-indexed",
      "name": "string — e.g. 'Foundation', 'Base Building'",
      "description": "string — 2-3 sentences describing what this phase focuses on and why",
      "startWeek": "integer — first week of this phase (1-indexed)",
      "endWeek": "integer — last week of this phase (1-indexed)",
      "focusAreas": ["string — e.g. 'aerobic_base', 'station_technique', 'race_simulation'"]
    }
  ]
}`;
}

function weekBatchSchema(): string {
  return `{
  "weeks": [
    {
      "weekNumber": "integer",
      "sessions": [
        {
          "dayOfWeek": "integer — 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun",
          "sessionType": "string — one of: 'station_skills', 'run', 'hyrox_day', 'rest'",
          "title": "string — e.g. 'Easy Run', 'SkiErg + Sled Push Skills'",
          "description": "string — 1-2 sentences",
          "targetPace": "string or null — e.g. '8:00/mile' for runs",
          "durationMinutes": "integer — estimated total duration",
          "equipmentRequired": ["string — e.g. 'skierg', 'sled'"],
          "detail": {
            "warmup": "string or null",
            "blocks": [
              {
                "label": "string — e.g. 'Main Set', 'Station Work'",
                "movements": [
                  {
                    "name": "string — movement name",
                    "prescription": "string — e.g. '3 × 500m @ 2:10/500m pace'",
                    "rest": "string or null — e.g. '45 sec between sets'",
                    "notes": "string or null — technique cues",
                    "equipmentNeeded": "string or null"
                  }
                ]
              }
            ],
            "cooldown": "string or null",
            "coachNotes": "string or null — why this session matters in the context of the plan",
            "estimatedDuration": "integer — minutes"
          }
        }
      ]
    }
  ]
}`;
}

function scenarioSchema(): string {
  return `[
  {
    "scenarioLabel": "string — e.g. 'Scenario A: Aspirational'",
    "description": "string — 1-2 sentence summary",
    "estimatedFinishSeconds": "integer — total estimated time in seconds",
    "bufferSeconds": "integer or null — seconds of buffer under goal time",
    "runStrategy": "string — e.g. 'negative split', 'even split'",
    "splits": [
      {
        "segmentNumber": "integer — 1-16 (alternating run/station)",
        "segmentType": "string — 'run' or 'station'",
        "segmentName": "string — e.g. 'Run 1 (1km)', 'SkiErg — 1,000m'",
        "targetSeconds": "integer",
        "paceDisplay": "string — e.g. '6:26/mile' or '1:45/500m'",
        "strategy": "string — brief strategy note",
        "cumulativeSeconds": "integer — running total"
      }
    ],
    "analysis": "string — paragraph analyzing where to find time, biggest gaps, and improvement levers",
    "sortOrder": "integer — 0 for primary scenario"
  }
]`;
}

async function callClaude(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 8192
): Promise<string> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  }, {
    timeout: 240_000, // 4 minutes — stay well under Vercel's 300s limit
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }
  return textBlock.text;
}

function parseJSON<T>(raw: string): T {
  // Strip markdown code fences if present
  const cleaned = raw
    .replace(/^```(?:json)?\n?/g, "")
    .replace(/\n?```$/g, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    // If the JSON is truncated (hit max_tokens), try to repair it by closing
    // open structures. This handles the most common case of a cut-off response.
    const repaired = repairTruncatedJSON(cleaned);
    try {
      return JSON.parse(repaired);
    } catch {
      // Re-throw the original error with context about the truncation
      const preview = cleaned.slice(Math.max(0, cleaned.length - 200));
      throw new Error(
        `Failed to parse AI response as JSON. Last 200 chars: ...${preview}`
      );
    }
  }
}

/**
 * Attempt to repair truncated JSON by closing open brackets, braces, and strings.
 * This handles the common case where the AI response is cut off mid-output.
 */
function repairTruncatedJSON(json: string): string {
  let repaired = json;

  // If we're inside an unterminated string, close it
  let inString = false;
  let escaped = false;
  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
    }
  }
  if (inString) {
    repaired += '"';
  }

  // Remove any trailing comma or incomplete key-value pair after last complete value
  repaired = repaired.replace(/,\s*$/, "");

  // Close open brackets and braces
  const stack: string[] = [];
  inString = false;
  escaped = false;
  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }

  // Close remaining open structures in reverse order
  while (stack.length > 0) {
    repaired += stack.pop();
  }

  return repaired;
}

// ---------------------------------------------------------------------------
// Main Inngest function
// ---------------------------------------------------------------------------

export const generateHyroxPlan = inngest.createFunction(
  {
    id: "hyrox-generate-plan",
    retries: 2,
    triggers: [{ event: "hyrox/plan.requested" }],
    onFailure: async ({ event, error }) => {
      const { planId } = event.data.event.data as { planId: string };
      if (!planId) return;

      const errorMessage = error?.message ?? "Unknown error during plan generation";
      console.error(`[hyrox-generate-plan] Plan ${planId} failed:`, errorMessage);

      await db
        .update(hyroxTrainingPlans)
        .set({ generationStatus: "failed" })
        .where(eq(hyroxTrainingPlans.id, planId));
    },
  },
  async ({ event, step }: { event: { data: { planId: string; snapshot: AthleteSnapshot } }; step: any }) => {
    const { planId, snapshot } = event.data as {
      planId: string;
      snapshot: AthleteSnapshot;
    };

    // Mark plan as generating
    await step.run("mark-generating", async () => {
      await db
        .update(hyroxTrainingPlans)
        .set({ generationStatus: "generating" })
        .where(eq(hyroxTrainingPlans.id, planId));
    });

    // Calculate total weeks
    const totalWeeks = await step.run("calc-weeks", () => {
      if (!snapshot.raceDate) return 12;
      const diff = new Date(snapshot.raceDate).getTime() - Date.now();
      return Math.max(4, Math.min(24, Math.ceil(diff / (7 * 24 * 60 * 60 * 1000))));
    });

    const systemPrompt = buildSystemPrompt();
    const athleteContext = buildAthleteContext(snapshot);

    // Step 1: Generate plan overview (phases)
    const overview = await step.run("generate-overview", async () => {
      const prompt = `${athleteContext}

## Task
Create a training plan overview for this athlete. The plan is ${totalWeeks} weeks long.

Divide it into appropriate phases (4-6 phases depending on plan length). For plans under 8 weeks use 3-4 phases. For 8-16 weeks use 4-5 phases. For 16+ weeks use 5-6 phases.

Respond with JSON matching this schema:
${planOverviewSchema()}`;

      const raw = await callClaude(systemPrompt, prompt);
      return parseJSON<AIPlanOverview>(raw);
    });

    // Save phases to DB
    const phaseRecords = await step.run("save-phases", async () => {
      const records = await db
        .insert(hyroxPlanPhases)
        .values(
          overview.phases.map((p: PlanPhase) => ({
            planId,
            phaseNumber: p.phaseNumber,
            name: p.name,
            description: p.description,
            startWeek: p.startWeek,
            endWeek: p.endWeek,
            focusAreas: p.focusAreas,
          }))
        )
        .returning();

      // Update plan with philosophy summary
      await db
        .update(hyroxTrainingPlans)
        .set({
          title: overview.title,
          trainingPhilosophy: { summary: overview.trainingPhilosophy },
        })
        .where(eq(hyroxTrainingPlans.id, planId));

      return records;
    });

    // Start scenario generation in parallel with week batches (scenarios
    // only depend on the athlete snapshot, not the week-by-week detail).
    const scenariosPromise = step.run("generate-scenarios", async () => {
      // Determine transition time based on athlete level
      const isProLevel =
        snapshot.division === "men_pro" ||
        snapshot.division === "women_pro" ||
        (snapshot.goalFinishTimeSeconds != null && snapshot.goalFinishTimeSeconds <= 3600);
      const transitionMinutes = isProLevel ? 3 : 5;
      const transitionPerStation = isProLevel ? "~20-25 seconds" : "~35-45 seconds";

      const prompt = `${athleteContext}

## Task
Generate 2-3 race-day scenarios for this athlete. The scenarios should represent:
1. **Aspirational** — goal station times achieved after training, comfortable run paces
2. **Current Fitness** — today's station times, possibly faster runs to compensate
3. **Conservative** (optional, include if plan is 12+ weeks) — moderate improvement, safe pacing

Each scenario must include all 16 segments (8 runs alternating with 8 stations in HYROX order):
Run 1 → SkiErg → Run 2 → Sled Push → Run 3 → Sled Pull → Run 4 → Burpee Broad Jumps → Run 5 → Rowing → Run 6 → Farmers Carry → Run 7 → Sandbag Lunges → Run 8 → Wall Balls

## Transition Time
Add ~${transitionMinutes}:00 total transition time (${transitionPerStation} × 8 transitions) to the final cumulative time. ${isProLevel ? "This athlete is at or targeting a pro/elite level, so transitions are assumed to be fast and efficient." : "This athlete is at a recreational/competitive level, so transitions include time for moving between stations, catching breath, and getting set up."}

In each scenario's "description" field, explicitly state how much total transition time was added (e.g., "Includes ${transitionMinutes}:00 of transition time across 8 stations").

Include an "analysis" field for each scenario that identifies the biggest time gaps and specific improvement levers (like the "Where to Find Time" section in a race plan).

${snapshot.goalFinishTimeSeconds ? `The athlete's goal is to finish in ${formatLongTime(snapshot.goalFinishTimeSeconds)}. Calculate buffer_seconds as the difference between the goal and estimated finish.` : "No specific time goal — focus scenarios on pacing strategy."}

Respond with JSON matching this schema (an array of scenarios):
${scenarioSchema()}`;

      const raw = await callClaude(systemPrompt, prompt);
      const scenarios = parseJSON<RaceScenario[]>(raw);

      if (scenarios.length > 0) {
        await db.insert(hyroxRaceScenarios).values(
          scenarios.map((s) => ({
            planId,
            scenarioLabel: s.scenarioLabel,
            description: s.description,
            estimatedFinishSeconds: s.estimatedFinishSeconds,
            bufferSeconds: s.bufferSeconds,
            runStrategy: s.runStrategy,
            splits: s.splits,
            analysis: s.analysis,
            sortOrder: s.sortOrder,
          }))
        );
      }
    });

    // Generate weeks in batches of 2 (sequential — each batch gets context
    // from the previous batch for continuity in progressive overload,
    // station rotation, and pacing). Smaller batches keep each Claude API
    // call under Vercel's 300s function timeout.
    const batchSize = 2;
    const batches: number[][] = [];
    for (let w = 1; w <= totalWeeks; w += batchSize) {
      const batch: number[] = [];
      for (let i = w; i < w + batchSize && i <= totalWeeks; i++) {
        batch.push(i);
      }
      batches.push(batch);
    }

    let previousWeeksSummary = "";

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const weekNums = batches[batchIdx];

      const batchSummary = await step.run(`generate-weeks-${weekNums[0]}-${weekNums[weekNums.length - 1]}`, async () => {
        // Find which phase each week belongs to
        const weekPhaseMap: Record<number, { phase: PlanPhase; phaseId: string }> = {};
        for (const wk of weekNums) {
          const phase = overview.phases.find(
            (p: PlanPhase) => wk >= p.startWeek && wk <= p.endWeek
          );
          const phaseRecord = phaseRecords.find(
            (r: { phaseNumber: number }) => r.phaseNumber === phase?.phaseNumber
          );
          if (phase && phaseRecord) {
            weekPhaseMap[wk] = { phase, phaseId: phaseRecord.id };
          }
        }

        const phaseContext = weekNums
          .map((wk) => {
            const entry = weekPhaseMap[wk];
            return entry
              ? `Week ${wk}: Phase "${entry.phase.name}" — ${entry.phase.description}`
              : `Week ${wk}`;
          })
          .join("\n");

        const continuityContext = previousWeeksSummary
          ? `\n## Previous Weeks (for continuity)\n${previousWeeksSummary}\n\nBuild on the progression above. Avoid repeating the same station pairings from the most recent 2 weeks. Continue progressive overload on run distances and paces.`
          : "\nThis is the first batch — establish the baseline for progressive overload.";

        const prompt = `${athleteContext}

## Plan Context
Total weeks: ${totalWeeks}
Phases:
${overview.phases.map((p: PlanPhase) => `- Phase ${p.phaseNumber}: ${p.name} (Weeks ${p.startWeek}-${p.endWeek}) — ${p.description}`).join("\n")}

## Current Batch
Generate detailed sessions for weeks ${weekNums.join(", ")}:
${phaseContext}
${continuityContext}

## Weekly Structure
Each week MUST have exactly these sessions:
- Day 0 (Mon): Station Skills — 5-10 min post-CrossFit add-on, 2 stations
- Day 1 (Tue): Easy Run — aerobic base building
- Day 2 (Wed): Station Skills — 5-10 min post-CrossFit add-on, 2 different stations from Monday
- Day 3 (Thu): Tempo/Race Pace Run — sustained effort
- Day 4 (Fri): Rest or optional light station skills (3-5 min)
- Day 5 (Sat): HYROX Day — intervals + station work, half/full sims in later phases
- Day 6 (Sun): Rest / Active Recovery

For station skills days, rotate through all 8 stations across 2-week blocks. Prioritize the athlete's lowest-confidence stations with extra volume.

For runs, progress paces and distances through the phases. Easy runs should be truly easy. Tempo runs progress from moderate to race pace.

For HYROX Days, progress from intervals with light station work → half simulations → full race simulations → taper shakeouts.

Respond with JSON matching this schema:
${weekBatchSchema()}`;

        const raw = await callClaude(systemPrompt, prompt, 8192);
        const batch = parseJSON<AIWeekBatch>(raw);

        // Save sessions to DB
        const sessionValues = batch.weeks.flatMap((week) =>
          week.sessions.map((session) => {
            const entry = weekPhaseMap[week.weekNumber];
            return {
              planId,
              week: week.weekNumber,
              dayOfWeek: session.dayOfWeek,
              sessionType: session.sessionType,
              title: session.title,
              description: session.description,
              targetPace: session.targetPace ?? null,
              durationMinutes: session.durationMinutes ?? null,
              phase: entry?.phase.name ?? "Unknown",
              orderInDay: 1,
              phaseId: entry?.phaseId ?? null,
              aiGenerated: true,
              athleteModified: false,
              sessionDetail: session.detail,
              equipmentRequired: session.equipmentRequired,
            };
          })
        );

        if (sessionValues.length > 0) {
          await db.insert(hyroxPlanSessions).values(sessionValues);
        }

        // Return a compact summary for the next batch's context
        const summary = batch.weeks.map((week) => {
          const stations = week.sessions
            .filter((s) => s.sessionType === "station_skills")
            .flatMap((s) => s.equipmentRequired)
            .filter(Boolean);
          const runSession = week.sessions.find((s) => s.sessionType === "run" && s.dayOfWeek === 1);
          const tempoSession = week.sessions.find((s) => s.sessionType === "run" && s.dayOfWeek === 3);
          return `Week ${week.weekNumber}: Stations [${stations.join(", ")}], Easy Run ${runSession?.targetPace ?? "N/A"} ${runSession?.durationMinutes ?? "?"}min, Tempo ${tempoSession?.targetPace ?? "N/A"} ${tempoSession?.durationMinutes ?? "?"}min`;
        }).join("\n");

        return summary;
      });

      previousWeeksSummary += (previousWeeksSummary ? "\n" : "") + batchSummary;
    }

    // Await scenario generation (may already be done)
    await scenariosPromise;

    // Mark plan as completed
    await step.run("mark-completed", async () => {
      await db
        .update(hyroxTrainingPlans)
        .set({
          generationStatus: "completed",
          totalWeeks,
          aiModel: AI_MODEL,
        })
        .where(eq(hyroxTrainingPlans.id, planId));
    });

    return { planId, status: "completed", totalWeeks };
  }
);
