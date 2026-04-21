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
import {
  computeScenarioSplits,
  type NumericScenario,
} from "@/lib/hyrox-scenario-compute";

const AI_MODEL = process.env.HYROX_TEST_MODE === "true"
  ? "claude-haiku-4-5-20251001"
  : "claude-sonnet-4-6";

// Vercel Pro allows 300s per function invocation. Set the Claude SDK timeout
// to 240s so that we get a clean SDK error (retryable by Inngest) instead of
// a hard FUNCTION_INVOCATION_TIMEOUT from Vercel.
const CLAUDE_TIMEOUT_MS = 240_000;

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

Equipment constraints (CRITICAL — follow strictly):
- The athlete's profile lists which equipment they have access to. NEVER program exercises that require equipment the athlete does not have.
- If the athlete is missing HYROX station equipment (e.g., no sled), you MUST substitute with equivalent exercises using only equipment they DO have. For example: replace sled push with heavy dumbbell walking lunges, burpee broad jumps, or assault bike sprints — but only if they have those items.
- Choose substitutions that target the same muscle groups and energy systems as the original HYROX station movement.
- When listing equipmentRequired for a session, only include equipment the athlete actually has.
- If the athlete has very limited equipment, get creative with bodyweight alternatives and whatever they do have available.

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

## Equipment
- Available: ${snapshot.availableEquipment.length > 0 ? snapshot.availableEquipment.join(", ") : "All standard HYROX equipment"}
- NOT available (do NOT program these): ${(() => {
    const allHyroxEquipment = ["skierg", "rower", "sled", "sandbag", "wall_ball_target", "assault_bike", "farmers_handles"];
    const missing = allHyroxEquipment.filter((e) => !snapshot.availableEquipment.includes(e));
    return missing.length > 0 ? missing.join(", ") : "None — athlete has all HYROX station equipment";
  })()}
- For any missing HYROX equipment above, substitute with equivalent exercises using ONLY the athlete's available equipment.

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

function weekSchema(): string {
  return `{
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
}`;
}

/** Schema for AI-generated qualitative text (no numeric fields). */
function scenarioTextSchema(): string {
  return `[
  {
    "scenarioLabel": "string — must match one of the provided scenario labels exactly",
    "description": "string — 1-2 sentence summary of this scenario's pacing approach and what it assumes about the athlete's improvement",
    "runStrategy": "string — e.g. 'natural pacing', 'negative split', 'even effort'",
    "analysis": "string — paragraph analyzing where to find time, biggest gaps between current and target, and specific improvement levers",
    "splitStrategies": ["string — 16 entries, one brief strategy note per segment in order (e.g. 'settle in, find rhythm', 'push through fatigue')"]
  }
]`;
}

async function callClaude(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 4096,
  label: string = "unknown"
): Promise<string> {
  const start = Date.now();
  console.log(`[hyrox-plan] Claude call started: ${label} (model=${AI_MODEL}, maxTokens=${maxTokens})`);

  // Disable the SDK's built-in retries. The default is maxRetries=2, which
  // means a timed-out request (240s) gets retried immediately — pushing total
  // time to 480s and blowing past Vercel's 300s function limit. Inngest
  // already handles retries at the step level, so SDK-level retries are
  // redundant and harmful here.
  const client = new Anthropic({ maxRetries: 0 });
  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  }, {
    timeout: CLAUDE_TIMEOUT_MS,
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[hyrox-plan] Claude call completed: ${label} (${elapsed}s, input=${response.usage.input_tokens}, output=${response.usage.output_tokens})`);

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

/**
 * Build a deterministic station rotation for a given week number. This allows
 * parallel week generation (each week is independent) while still ensuring
 * stations are covered evenly and weak stations get extra attention.
 *
 * Returns { monday: [station, station], wednesday: [station, station] }
 */
function getStationRotation(
  weekNumber: number,
  snapshot: AthleteSnapshot,
): { monday: string[]; wednesday: string[] } {
  const stations = [...STATION_ORDER];

  // Sort by confidence (weakest first) for prioritisation
  const confidenceMap = new Map(
    snapshot.stationAssessments.map((a) => [a.station, a.completionConfidence ?? 3])
  );
  const sortedByWeakness = [...stations].sort(
    (a, b) => (confidenceMap.get(a) ?? 3) - (confidenceMap.get(b) ?? 3)
  );

  // 8 stations, 4 per week (2 Mon + 2 Wed). Full rotation every 2 weeks.
  // Even weeks: first 4 stations, odd weeks: last 4 stations.
  // Use weakness-sorted order so weaker stations appear more frequently
  // (they're at the front of the list, appearing in week 1, 3, 5, …).
  const parity = (weekNumber - 1) % 2;
  const weekStations = parity === 0
    ? sortedByWeakness.slice(0, 4)
    : sortedByWeakness.slice(4, 8);

  return {
    monday: weekStations.slice(0, 2),
    wednesday: weekStations.slice(2, 4),
  };
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

      const raw = await callClaude(systemPrompt, prompt, 4096, "plan-overview");
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

    // -----------------------------------------------------------------------
    // Generate ALL weeks in parallel + scenarios.
    //
    // Each week is an independent Inngest step (= separate Vercel invocation).
    // Inngest detects un-awaited step.run() promises and executes them
    // concurrently, so a 20-week plan generates ~20 weeks at once instead
    // of sequentially. Total wall-clock time ≈ slowest single week, not
    // the sum of all weeks.
    //
    // To maintain quality without sequential context, each week gets:
    // - Full athlete profile + phase descriptions
    // - Its position in the plan (week X of Y, % through phase)
    // - Deterministic station rotation (computed from week number)
    // - Progression guidance based on phase position
    // -----------------------------------------------------------------------

    // Kick off scenario generation (independent of weeks)
    // Numeric splits are computed deterministically from real HYROX percentile
    // data; AI only generates qualitative text (strategy notes, analysis).
    const scenariosPromise = step.run("generate-scenarios", async () => {
      // 1. Compute numeric splits from athlete data + real distributions
      const numericScenarios = computeScenarioSplits(snapshot, totalWeeks);

      // 2. Build a summary of the computed splits for the AI prompt
      const splitsForPrompt = numericScenarios.map((sc) => ({
        scenarioLabel: sc.scenarioLabel,
        estimatedFinish: formatLongTime(sc.estimatedFinishSeconds),
        bufferSeconds: sc.bufferSeconds,
        splits: sc.splits.map((s) => ({
          segmentName: s.segmentName,
          segmentType: s.segmentType,
          targetTime: formatTime(s.targetSeconds),
          pace: s.paceDisplay,
        })),
      }));

      // 3. Ask AI for qualitative text only — no arithmetic
      const prompt = `${athleteContext}

## Task
Below are pre-computed race-day scenarios for this athlete. The times were calculated from real HYROX percentile data and the athlete's current fitness.

${JSON.stringify(splitsForPrompt, null, 2)}

For each scenario, generate ONLY the qualitative text:
1. A 1-2 sentence **description** summarizing the pacing approach and what improvement the scenario assumes
2. A **runStrategy** label (e.g. "natural pacing", "negative split", "even effort")
3. An **analysis** paragraph identifying the biggest time gaps between current and target, specific stations or runs where time can be gained, and tactical advice for race day
4. **splitStrategies**: an array of exactly ${numericScenarios[0]?.splits.length ?? 16} brief strategy notes, one per segment in order (e.g. "settle in, find rhythm", "push through fatigue after sled pull", "empty the tank on the final km")

${snapshot.goalFinishTimeSeconds ? `The athlete's goal is to finish in ${formatLongTime(snapshot.goalFinishTimeSeconds)}.` : "No specific time goal — focus on pacing strategy."}

Respond with JSON matching this schema:
${scenarioTextSchema()}`;

      interface ScenarioText {
        scenarioLabel: string;
        description: string;
        runStrategy: string;
        analysis: string;
        splitStrategies: string[];
      }

      let qualitative: ScenarioText[] = [];
      try {
        const raw = await callClaude(systemPrompt, prompt, 2048, "race-scenario-text");
        qualitative = parseJSON<ScenarioText[]>(raw);
      } catch (err) {
        // If AI text generation fails, we still persist the scenarios with
        // correct numeric data — just with empty strategy text.
        console.warn("[hyrox-plan] Scenario text generation failed, using empty text:", err);
      }

      // 4. Merge numeric + qualitative
      const scenarios: RaceScenario[] = numericScenarios.map((numeric) => {
        const text = qualitative.find((q) => q.scenarioLabel === numeric.scenarioLabel);
        return {
          scenarioLabel: numeric.scenarioLabel,
          description: text?.description ?? `${numeric.scenarioLabel} scenario`,
          estimatedFinishSeconds: numeric.estimatedFinishSeconds,
          bufferSeconds: numeric.bufferSeconds,
          runStrategy: text?.runStrategy ?? "natural pacing",
          splits: numeric.splits.map((split, i) => ({
            ...split,
            strategy: text?.splitStrategies[i] ?? "",
          })),
          analysis: text?.analysis ?? null,
          sortOrder: numeric.sortOrder,
        };
      });

      // 5. Persist
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

    // Kick off ALL week generation steps in parallel (not awaited individually)
    const weekPromises = Array.from({ length: totalWeeks }, (_, i) => {
      const weekNumber = i + 1;
      return step.run(`generate-week-${weekNumber}`, async () => {
        // Find which phase this week belongs to
        const phase = overview.phases.find(
          (p: PlanPhase) => weekNumber >= p.startWeek && weekNumber <= p.endWeek
        );
        const phaseRecord = phaseRecords.find(
          (r: { phaseNumber: number }) => r.phaseNumber === phase?.phaseNumber
        );

        // Compute where we are in the plan and phase for progression guidance
        const planProgress = weekNumber / totalWeeks; // 0..1
        const phaseProgress = phase
          ? (weekNumber - phase.startWeek) / (phase.endWeek - phase.startWeek + 1)
          : 0;
        const phasePosition = phaseProgress < 0.33 ? "early" : phaseProgress < 0.67 ? "mid" : "late";

        // Deterministic station rotation
        const rotation = getStationRotation(weekNumber, snapshot);

        const prompt = `${athleteContext}

## Plan Context
${totalWeeks}-week plan. Phases: ${overview.phases.map((p: PlanPhase) => `${p.name} (W${p.startWeek}-${p.endWeek})`).join(", ")}

## Week ${weekNumber} of ${totalWeeks}
Phase: "${phase?.name ?? "Unknown"}" — ${phase?.description ?? ""}
Position: ${phasePosition} in phase (week ${phase ? weekNumber - phase.startWeek + 1 : "?"} of ${phase ? phase.endWeek - phase.startWeek + 1 : "?"})
Overall progress: ${Math.round(planProgress * 100)}% through plan

## Station Rotation This Week
- Monday: ${rotation.monday.join(" + ")}
- Wednesday: ${rotation.wednesday.join(" + ")}
${weekNumber <= totalWeeks - 2 ? "" : "This is a taper week — reduce station volume, keep movements crisp."}

## Progression Guidance
- Easy run distance: ${planProgress < 0.3 ? "3-4 miles (building base)" : planProgress < 0.7 ? "4-6 miles (building endurance)" : planProgress < 0.85 ? "5-7 miles (peak volume)" : "3-4 miles (taper)"}
- Tempo intensity: ${planProgress < 0.3 ? "moderate pace, shorter intervals" : planProgress < 0.7 ? "tempo pace, longer sustained efforts" : planProgress < 0.85 ? "race pace, race-specific intervals" : "short race-pace sharpeners"}
- Saturday HYROX Day: ${planProgress < 0.3 ? "intervals with station technique focus" : planProgress < 0.5 ? "longer intervals, partial station circuits" : planProgress < 0.8 ? "half or full race simulations" : "short shakeout simulation, stay fresh"}

## Weekly Structure (7 sessions)
- Day 0 (Mon): Station Skills — 5-10 min post-CrossFit, focus on ${rotation.monday.join(" + ")}
- Day 1 (Tue): Easy Run
- Day 2 (Wed): Station Skills — 5-10 min post-CrossFit, focus on ${rotation.wednesday.join(" + ")}
- Day 3 (Thu): Tempo/Race Pace Run
- Day 4 (Fri): Rest or optional light station skills (3-5 min)
- Day 5 (Sat): HYROX Day — ${planProgress < 0.5 ? "intervals + station work (45-60 min)" : planProgress < 0.85 ? "simulation day (60-90 min)" : "taper shakeout (30-45 min)"}
- Day 6 (Sun): Rest / Active Recovery

REMINDER: Only use equipment the athlete has. For any station the athlete lacks equipment for, substitute with an equivalent movement using their available gear. Do NOT include sled work if they don't have a sled, SkiErg work if they don't have a SkiErg, etc.

Respond with JSON matching this schema:
${weekSchema()}`;

        const raw = await callClaude(systemPrompt, prompt, 8192, `week-${weekNumber}`);
        // The response is a single week object (not wrapped in { weeks: [] })
        // but we also accept the batch format for robustness.
        const parsed = parseJSON<AIWeekBatch["weeks"][0] | AIWeekBatch>(raw);
        const week = "sessions" in parsed ? parsed : (parsed as AIWeekBatch).weeks[0];

        const sessionValues = week.sessions.map((session) => ({
          planId,
          week: weekNumber,
          dayOfWeek: session.dayOfWeek,
          sessionType: session.sessionType,
          title: session.title,
          description: session.description,
          targetPace: session.targetPace ?? null,
          durationMinutes: session.durationMinutes ?? null,
          phase: phase?.name ?? "Unknown",
          orderInDay: 1,
          phaseId: phaseRecord?.id ?? null,
          aiGenerated: true,
          athleteModified: false,
          sessionDetail: session.detail,
          equipmentRequired: session.equipmentRequired,
        }));

        if (sessionValues.length > 0) {
          await db.insert(hyroxPlanSessions).values(sessionValues);
        }
      });
    });

    // Wait for all weeks + scenarios to finish
    await Promise.all([...weekPromises, scenariosPromise]);

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
