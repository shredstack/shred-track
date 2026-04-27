import Anthropic from "@anthropic-ai/sdk";
import { inngest } from "../client";
import { db } from "@/db";
import {
  hyroxPracticeRaces,
  hyroxPracticeRaceSplits,
  hyroxRaceReports,
  hyroxProfiles,
  hyroxTrainingPlans,
} from "@/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  DIVISION_REF_DATA,
  estimatePercentile,
  formatLongTime,
  formatTime,
  type DivisionKey,
  type StationName,
} from "@/lib/hyrox-data";
import type {
  TimeLossEntry,
  FocusEntry,
} from "@/types/hyrox-race-report";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const AI_MODEL = process.env.HYROX_TEST_MODE === "true"
  ? "claude-haiku-4-5-20251001"
  : "claude-sonnet-4-6";

const CLAUDE_TIMEOUT_MS = 180_000; // 3 min — analysis is much smaller than plan gen

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

interface AIQualitativeOutput {
  headline: string;
  pacingAnalysis: string;
  prioritizedFocus: FocusEntry[];
  projectedFinishAssumptions: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseAIJson<T>(raw: string): T {
  const cleaned = raw
    .replace(/^```(?:json)?\n?/g, "")
    .replace(/\n?```$/g, "")
    .trim();
  return JSON.parse(cleaned) as T;
}

function gapPctTone(gapPct: number): string {
  if (gapPct <= 0.05) {
    return "The athlete is on track for their goal time. Focus on race-day execution and sharpening, not large fitness gains.";
  }
  if (gapPct <= 0.15) {
    return "The athlete is in striking distance of their goal. Concentrate on the top 1–2 time-loss segments where the biggest gains live.";
  }
  return "The athlete is significantly off goal. Be honest about the gap. Suggest the projected finish time as a more realistic interim target. Do NOT promise the goal time is reachable in the remaining weeks.";
}

// ---------------------------------------------------------------------------
// Inngest function
// ---------------------------------------------------------------------------

export const generateRaceReport = inngest.createFunction(
  {
    id: "hyrox-generate-race-report",
    retries: 2,
    triggers: [{ event: "hyrox/race.completed" }],
    onFailure: async ({ event, error }) => {
      const { raceId } = event.data.event.data as { raceId: string };
      if (!raceId) return;
      const errorMessage = error?.message ?? "Unknown error during report generation";
      console.error(`[hyrox-generate-race-report] Race ${raceId} failed:`, errorMessage);
      await db
        .update(hyroxRaceReports)
        .set({
          status: "failed",
          generationError: errorMessage,
          generationCompletedAt: new Date(),
        })
        .where(eq(hyroxRaceReports.raceId, raceId));
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: { event: { data: { raceId: string; userId: string } }; step: any }) => {
    const { raceId, userId } = event.data;

    // ----- Step 1: gather inputs ------------------------------------------
    const inputs = await step.run("gather-inputs", async () => {
      const [race] = await db
        .select()
        .from(hyroxPracticeRaces)
        .where(
          and(
            eq(hyroxPracticeRaces.id, raceId),
            eq(hyroxPracticeRaces.userId, userId),
          ),
        )
        .limit(1);
      if (!race) throw new Error(`Race ${raceId} not found for user ${userId}`);

      const splits = await db
        .select()
        .from(hyroxPracticeRaceSplits)
        .where(eq(hyroxPracticeRaceSplits.raceId, raceId))
        .orderBy(asc(hyroxPracticeRaceSplits.segmentOrder));

      const [profile] = await db
        .select()
        .from(hyroxProfiles)
        .where(eq(hyroxProfiles.userId, userId))
        .limit(1);

      const priorRaces = await db
        .select()
        .from(hyroxPracticeRaces)
        .where(eq(hyroxPracticeRaces.userId, userId))
        .orderBy(desc(hyroxPracticeRaces.completedAt))
        .limit(6); // current + 5 prior

      const [activePlan] = await db
        .select()
        .from(hyroxTrainingPlans)
        .where(
          and(
            eq(hyroxTrainingPlans.userId, userId),
            eq(hyroxTrainingPlans.status, "active"),
          ),
        )
        .limit(1);

      return { race, splits, profile, priorRaces, activePlan };
    });

    // ----- Step 2: mark generating ----------------------------------------
    await step.run("mark-generating", async () => {
      // Make sure there's a row to update; if the POST endpoint pre-created one
      // it'll just bump status — otherwise we insert a fresh pending row.
      const existing = await db
        .select()
        .from(hyroxRaceReports)
        .where(eq(hyroxRaceReports.raceId, raceId))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(hyroxRaceReports).values({
          raceId,
          userId,
          status: "generating",
          generationStartedAt: new Date(),
        });
      } else {
        await db
          .update(hyroxRaceReports)
          .set({
            status: "generating",
            generationStartedAt: new Date(),
            generationError: null,
          })
          .where(eq(hyroxRaceReports.raceId, raceId));
      }
    });

    // ----- Step 3: deterministic numerics ---------------------------------
    const numerics = await step.run("compute-numerics", async () => {
      const { race, splits, profile } = inputs;
      const divisionKey =
        (race.divisionKey as DivisionKey | null) ?? null;
      const refData = divisionKey ? DIVISION_REF_DATA[divisionKey] : null;

      // Compute seconds lost vs p25 for every segment with reference data.
      // (Lower percentile = better; p25 = "Top 25%" benchmark.)
      const losses: TimeLossEntry[] = [];
      for (const split of splits) {
        const seconds = parseFloat(split.timeSeconds);
        if (!refData) continue;
        let dist: number[] | undefined;
        if (split.segmentType === "run") {
          dist = refData.runs[split.segmentLabel];
        } else {
          dist = refData.stations[split.segmentLabel as StationName];
        }
        if (!dist || dist.length < 5) continue;
        const p25 = dist[1];
        const percentile = estimatePercentile(seconds, dist as [number, number, number, number, number]);
        const secondsLost = Math.max(0, seconds - p25);
        losses.push({
          station: split.segmentLabel,
          secondsLost: Math.round(secondsLost),
          percentile,
          p25Time: Math.round(p25),
        });
      }

      // Top 3 time losses (descending).
      const top3 = [...losses]
        .sort((a, b) => b.secondsLost - a.secondsLost)
        .slice(0, 3)
        .filter((l) => l.secondsLost > 0);

      const top3Sum = top3.reduce((sum, l) => sum + l.secondsLost, 0);
      const totalFinishSeconds = Math.round(parseFloat(race.totalTimeSeconds));
      const projectedFinishSeconds = Math.max(
        0,
        totalFinishSeconds - top3Sum,
      );

      // Pacing snapshot — Run 1 vs avg of Run 2..N
      const runs = (splits as Array<{ segmentType: string; timeSeconds: string }>).filter(
        (s) => s.segmentType === "run",
      );
      let run1Seconds: number | null = null;
      let avgRestRunsSeconds: number | null = null;
      if (runs.length > 1) {
        run1Seconds = parseFloat(runs[0].timeSeconds);
        const rest: number[] = runs.slice(1).map((r) => parseFloat(r.timeSeconds));
        avgRestRunsSeconds = rest.reduce((s: number, v: number) => s + v, 0) / rest.length;
      }

      // Goal-gap context
      const goalSeconds = profile?.goalFinishTimeSeconds ?? null;
      const gapToGoalSeconds = goalSeconds
        ? totalFinishSeconds - goalSeconds
        : null;
      const gapPct = goalSeconds
        ? gapToGoalSeconds! / goalSeconds
        : null;

      return {
        timeLossRanking: top3,
        projectedFinishSeconds,
        run1Seconds,
        avgRestRunsSeconds,
        gapToGoalSeconds,
        gapPct,
        totalFinishSeconds,
      };
    });

    // ----- Step 4: call Claude for qualitative text -----------------------
    const aiOutput = await step.run("call-ai", async () => {
      const { race, profile, priorRaces, activePlan } = inputs;

      const divisionKey = race.divisionKey ?? "unknown";
      const losses: TimeLossEntry[] = numerics.timeLossRanking;
      const lossRows = losses
        .map(
          (l: TimeLossEntry) =>
            `- ${l.station}: lost ${l.secondsLost}s vs P25 (currently P${l.percentile})`,
        )
        .join("\n") || "- (no segments below P25 — athlete already strong across the board)";

      const priors: Array<{
        id: string;
        completedAt: string | Date;
        template: string;
        totalTimeSeconds: string;
      }> = priorRaces;
      const trajectory = priors
        .filter((r) => r.id !== race.id)
        .slice(0, 4)
        .map(
          (r) =>
            `- ${new Date(r.completedAt).toISOString().slice(0, 10)} · ${r.template} · ${formatLongTime(Math.round(parseFloat(r.totalTimeSeconds)))}`,
        )
        .join("\n") || "- (no prior race history)";

      const goalLine = profile?.goalFinishTimeSeconds
        ? `${formatLongTime(profile.goalFinishTimeSeconds)} (gap ${numerics.gapToGoalSeconds! >= 0 ? "+" : "−"}${formatTime(Math.abs(numerics.gapToGoalSeconds!))} = ${(numerics.gapPct! * 100).toFixed(1)}%)`
        : "not set";

      const toneGuidance = numerics.gapPct != null ? gapPctTone(numerics.gapPct) : "Athlete has not set a goal time. Focus on the largest improvement opportunities revealed by the splits.";

      const planLine = activePlan
        ? `Active plan: "${activePlan.title}" · phase context unknown · ends ${activePlan.endDate}`
        : "No active training plan.";

      const pacingLine = numerics.run1Seconds != null && numerics.avgRestRunsSeconds != null
        ? `Run 1 = ${formatTime(Math.round(numerics.run1Seconds))}, avg of Runs 2+ = ${formatTime(Math.round(numerics.avgRestRunsSeconds))} (Run 1 is ${numerics.run1Seconds < numerics.avgRestRunsSeconds ? "FASTER" : "slower"} by ${formatTime(Math.round(Math.abs(numerics.run1Seconds - numerics.avgRestRunsSeconds)))})`
        : "Pacing data unavailable (insufficient run splits).";

      const systemPrompt = `You are an elite HYROX coach analyzing a single race result. The numbers are PRE-COMPUTED and provided. Your job is qualitative analysis only — DO NOT recompute or restate numbers in the headline (the UI shows them). Output JSON only — no markdown, no explanation.

Rules:
- The "projectedFinishSeconds" is fixed; you do not produce that field. You only produce the qualitative *assumptions* string explaining what improvements are baked into it.
- "prioritizedFocus" should reflect the top time-loss segments above, but you may bundle related stations (e.g. Sled Push + Sled Pull) into one focus if it makes coaching sense.
- Tone guidance: ${toneGuidance}
- Be specific. "Improve burpee broad jumps" is too generic — say WHAT to work on (e.g. "explosive hip drive on the broad jump" or "smoother burpee → jump transition").
- Sessions per week: 1–3. Duration weeks: 2–8. Be realistic.`;

      const userPrompt = `## Race Summary
- Division: ${divisionKey}
- Template: ${race.template}
- Finish: ${formatLongTime(numerics.totalFinishSeconds)}
- Goal: ${goalLine}
- Race type: ${race.raceType}

## Top time-loss segments (deterministic, vs P25)
${lossRows}

## Pacing
${pacingLine}

## Prior race trajectory (most recent 4)
${trajectory}

## Plan context
${planLine}

## Required JSON shape
{
  "headline": "string — one sentence, max 110 chars, no leading/trailing quotes",
  "pacingAnalysis": "string — 2-4 sentences, what the splits reveal about pacing strategy and execution",
  "prioritizedFocus": [
    { "focus": "string", "rationale": "string", "sessionsPerWeek": 1, "durationWeeks": 4 }
  ],
  "projectedFinishAssumptions": "string — what improvements were assumed to reach the projected finish time"
}`;

      const client = new Anthropic({ maxRetries: 0 });
      const start = Date.now();
      console.log(`[generate-race-report] Calling Claude for race=${race.id} model=${AI_MODEL}`);

      const response = await client.messages.create(
        {
          model: AI_MODEL,
          max_tokens: 2048,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        },
        { timeout: CLAUDE_TIMEOUT_MS },
      );

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[generate-race-report] Claude responded in ${elapsed}s — input=${response.usage.input_tokens}, output=${response.usage.output_tokens}`);

      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("Empty Claude response");
      }
      return parseAIJson<AIQualitativeOutput>(textBlock.text);
    });

    // ----- Step 5: persist ------------------------------------------------
    await step.run("persist", async () => {
      await db
        .update(hyroxRaceReports)
        .set({
          status: "completed",
          headline: aiOutput.headline,
          pacingAnalysis: aiOutput.pacingAnalysis,
          timeLossRanking: numerics.timeLossRanking,
          prioritizedFocus: aiOutput.prioritizedFocus,
          projectedFinishSeconds: numerics.projectedFinishSeconds,
          projectedFinishAssumptions: aiOutput.projectedFinishAssumptions,
          aiModel: AI_MODEL,
          generationCompletedAt: new Date(),
          generationError: null,
        })
        .where(eq(hyroxRaceReports.raceId, raceId));
    });

    // ----- Step 6: flag plan recalibration if appropriate -----------------
    await step.run("flag-recalibration", async () => {
      const { activePlan } = inputs;
      if (!activePlan) return;
      // Only paid (personalized) plans get recalibration.
      if (activePlan.planType !== "personalized") return;

      // Plan must have > 4 weeks remaining.
      const fourWeeksOut = new Date();
      fourWeeksOut.setDate(fourWeeksOut.getDate() + 28);
      const planEnd = new Date(activePlan.endDate);
      if (planEnd <= fourWeeksOut) return;

      // Race must have moved the dial — i.e. there's at least one segment with secondsLost ≥ 30s.
      const lossList: TimeLossEntry[] = numerics.timeLossRanking;
      const hasSignificantLoss = lossList.some(
        (l: TimeLossEntry) => l.secondsLost >= 30,
      );
      if (!hasSignificantLoss) return;

      await db
        .update(hyroxTrainingPlans)
        .set({
          recalibrationSuggestedAt: new Date(),
          recalibrationSourceRaceId: raceId,
        })
        .where(eq(hyroxTrainingPlans.id, activePlan.id));
    });

    return { raceId, status: "completed" };
  },
);
