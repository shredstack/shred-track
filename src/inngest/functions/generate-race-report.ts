import Anthropic from "@anthropic-ai/sdk";
import { inngest } from "../client";
import { db } from "@/db";
import {
  hyroxPracticeRaces,
  hyroxPracticeRaceSplits,
  hyroxRaceReports,
  hyroxProfiles,
  hyroxTrainingPlans,
  hyroxStationBenchmarks,
} from "@/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  DIVISIONS,
  DIVISION_REF_DATA,
  STATION_PACE_TYPE,
  computeAvgRunPaceSecPerKm,
  estimatePercentile,
  formatLongTime,
  formatRunPace,
  formatStationPace,
  formatTime,
  isCanonicalAttempt,
  parseDistanceToMeters,
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

// ---------------------------------------------------------------------------
// Custom-race extrapolation
// ---------------------------------------------------------------------------
//
// For canonical (Full/Half) races the "Projected finish" is interpretive —
// "what would you finish in if you fixed your top time-loss segments". That
// number is computed against the division percentile distributions in
// DIVISION_REF_DATA.
//
// For custom races those distributions don't apply (the athlete may have
// dropped stations, shortened distances, or scaled weights), so we
// instead extrapolate what a CANONICAL full HYROX would look like if the
// athlete held their observed pace:
//
//   1. Average run pace (sec/km) → scale to runSegments × runDistanceM.
//   2. For each canonical station, estimate a time:
//      a. If the athlete attempted it in the custom race, scale the
//         actual time linearly by distance (per500m / "total" stations)
//         or by reps (perRep stations).
//      b. Else use the athlete's prior canonical PR for that station.
//      c. Else fall back to the division's P50.
//
// The result powers both the persisted `projected_finish_seconds` and the
// deterministic facts passed to Claude for qualitative analysis.

interface SplitLike {
  segmentType: string;
  segmentSubtype: string | null;
  segmentLabel: string;
  timeSeconds: string;
  distanceMeters: number | null;
  reps: number | null;
  weightKg: string | null;
}

interface BenchmarkLike {
  station: string;
  timeSeconds: number;
  distanceMeters: number | null;
  reps: number | null;
  weightKg: string | null;
}

interface StationEstimate {
  station: string;
  estimatedSeconds: number;
  source: "scaled" | "prior_pr" | "p50";
  actualSeconds?: number;
  actualDistanceMeters?: number;
  actualReps?: number;
  canonicalDistanceMeters: number | null;
  canonicalReps: number | null;
}

export interface ExtrapolationResult {
  totalSeconds: number;
  runSeconds: number;
  stationSeconds: number;
  /** sec/km, rounded — null when neither measured pace nor a P50 fallback exists. */
  avgRunPaceSecPerKm: number | null;
  paceSource: "measured" | "fallback_p50";
  canonicalRunSegments: number;
  canonicalRunDistanceM: number;
  stations: StationEstimate[];
  droppedStations: string[];
}

function extrapolateFullRace(
  divisionKey: DivisionKey | null,
  splits: SplitLike[],
  benchmarks: BenchmarkLike[],
): ExtrapolationResult | null {
  if (!divisionKey) return null;
  const div = DIVISIONS[divisionKey];
  if (!div) return null;
  const refData = DIVISION_REF_DATA[divisionKey] ?? null;

  // Average run pace — weighted by measured distance, falling back to the
  // division's nominal run distance per spec.
  const runSplitsForPace = splits.map((s) => ({
    segmentType: s.segmentType as "run" | "station",
    segmentSubtype: (s.segmentSubtype as "prescribed_run" | "roxzone" | null) ?? null,
    timeSeconds: s.timeSeconds,
    distanceMeters: s.distanceMeters,
  }));
  let avgPace = computeAvgRunPaceSecPerKm(runSplitsForPace, div.runDistanceM);
  let paceSource: "measured" | "fallback_p50" = "measured";
  if (avgPace == null) {
    const run1P50 = refData?.runs["Run 1"]?.[2];
    if (run1P50 && div.runDistanceM > 0) {
      avgPace = (run1P50 / div.runDistanceM) * 1000;
      paceSource = "fallback_p50";
    } else {
      return null;
    }
  }
  const runSeconds = Math.round(
    (avgPace * div.runSegments * div.runDistanceM) / 1000,
  );

  const stations: StationEstimate[] = [];
  const droppedStations: string[] = [];

  for (const spec of div.stations) {
    const station = spec.name;
    const canonicalDist = spec.distance
      ? parseDistanceToMeters(spec.distance)
      : null;
    const canonicalReps = spec.reps ?? null;
    const paceType = STATION_PACE_TYPE[station] ?? "total";

    const split = splits.find(
      (s) => s.segmentType === "station" && s.segmentLabel === station,
    );

    let scaled: number | null = null;
    if (split) {
      const actualTime = parseFloat(split.timeSeconds);
      if (paceType === "perRep") {
        if (split.reps && split.reps > 0 && canonicalReps) {
          scaled = (actualTime * canonicalReps) / split.reps;
        }
      } else if (
        split.distanceMeters &&
        split.distanceMeters > 0 &&
        canonicalDist
      ) {
        // per500m + "total" stations are distance-keyed.
        scaled = (actualTime * canonicalDist) / split.distanceMeters;
      }
      if (scaled != null && isFinite(scaled) && scaled > 0) {
        stations.push({
          station,
          estimatedSeconds: Math.round(scaled),
          source: "scaled",
          actualSeconds: Math.round(actualTime),
          actualDistanceMeters: split.distanceMeters ?? undefined,
          actualReps: split.reps ?? undefined,
          canonicalDistanceMeters: canonicalDist,
          canonicalReps,
        });
        continue;
      }
      // Attempted but missing the metadata we'd need to scale — treat
      // like a dropped station and fall through to PR / P50.
    } else {
      droppedStations.push(station);
    }

    const priorCanonical = benchmarks.filter(
      (b) =>
        b.station === station &&
        isCanonicalAttempt(
          station,
          divisionKey,
          b.distanceMeters,
          b.reps,
          b.weightKg != null ? Number(b.weightKg) : null,
        ),
    );
    if (priorCanonical.length > 0) {
      const best = Math.min(...priorCanonical.map((b) => b.timeSeconds));
      stations.push({
        station,
        estimatedSeconds: best,
        source: "prior_pr",
        canonicalDistanceMeters: canonicalDist,
        canonicalReps,
      });
      continue;
    }

    const p50 = refData?.stations[station as StationName]?.[2];
    if (p50) {
      stations.push({
        station,
        estimatedSeconds: Math.round(p50),
        source: "p50",
        canonicalDistanceMeters: canonicalDist,
        canonicalReps,
      });
    }
    // No data at all (rare; ref data missing for this division) — leave
    // the station out of the total. The dropped list still flags it.
  }

  const stationSeconds = stations.reduce((sum, e) => sum + e.estimatedSeconds, 0);

  return {
    totalSeconds: runSeconds + stationSeconds,
    runSeconds,
    stationSeconds,
    avgRunPaceSecPerKm: Math.round(avgPace),
    paceSource,
    canonicalRunSegments: div.runSegments,
    canonicalRunDistanceM: div.runDistanceM,
    stations,
    droppedStations,
  };
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

      // Pull recent station benchmarks for prior-PR fallback during
      // custom-race extrapolation. The list is small (one row per
      // station attempt), so the limit is generous.
      const benchmarks = await db
        .select({
          station: hyroxStationBenchmarks.station,
          timeSeconds: hyroxStationBenchmarks.timeSeconds,
          distanceMeters: hyroxStationBenchmarks.distanceMeters,
          reps: hyroxStationBenchmarks.reps,
          weightKg: hyroxStationBenchmarks.weightKg,
        })
        .from(hyroxStationBenchmarks)
        .where(eq(hyroxStationBenchmarks.userId, userId))
        .orderBy(desc(hyroxStationBenchmarks.loggedAt))
        .limit(200);

      return { race, splits, profile, priorRaces, activePlan, benchmarks };
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
      const { race, splits, profile, benchmarks } = inputs;
      const divisionKey =
        (race.divisionKey as DivisionKey | null) ?? null;
      // DIVISION_REF_DATA distributions are calibrated to the canonical
      // Full / Half formats. A custom race may have shortened runs,
      // reduced reps, or scaled weights — comparing those times to the
      // standard percentile distribution is misleading, so skip the
      // percentile-based time-loss block for custom races entirely.
      const isCustom = race.template === "custom";
      const refData = isCustom
        ? null
        : divisionKey
          ? DIVISION_REF_DATA[divisionKey]
          : null;

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

      // Projected finish: branches by template.
      //  - canonical races: current finish minus the top time-loss segments
      //    ("if you fix these, you finish here").
      //  - custom races: extrapolated full-HYROX finish at the athlete's
      //    observed pace, filling dropped stations from prior PR / P50.
      let projectedFinishSeconds: number;
      let projectionType: "improvement" | "extrapolation";
      let extrapolation: ExtrapolationResult | null = null;

      if (isCustom) {
        extrapolation = extrapolateFullRace(
          divisionKey,
          splits as SplitLike[],
          benchmarks as BenchmarkLike[],
        );
        if (extrapolation) {
          projectedFinishSeconds = extrapolation.totalSeconds;
          projectionType = "extrapolation";
        } else {
          // Couldn't extrapolate (no runs and no ref data for division).
          // Fall back to echoing the custom finish — the UI will still
          // render but the assumptions text will explain.
          projectedFinishSeconds = totalFinishSeconds;
          projectionType = "extrapolation";
        }
      } else {
        projectedFinishSeconds = Math.max(0, totalFinishSeconds - top3Sum);
        projectionType = "improvement";
      }

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
        projectionType,
        extrapolation,
        run1Seconds,
        avgRestRunsSeconds,
        gapToGoalSeconds,
        gapPct,
        totalFinishSeconds,
      };
    });

    // ----- Step 4: call Claude for qualitative text -----------------------
    const aiOutput = await step.run("call-ai", async () => {
      const { race, profile, priorRaces, activePlan, splits } = inputs;

      const divisionKey = race.divisionKey ?? "unknown";
      const isCustom = race.template === "custom";

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

      // -- Branched analysis sections ----------------------------------
      // Canonical (Full/Half) races: percentile-based time-loss ranking
      // drives the analysis. Custom races: per-segment paces and a
      // full-HYROX extrapolation drive it, because percentile comparisons
      // against canonical distributions are misleading when the athlete
      // ran shortened distances or dropped stations entirely.

      let analysisSection: string;
      let projectionInstructions: string;

      if (isCustom) {
        const ex: ExtrapolationResult | null = numerics.extrapolation;
        const customSplits: SplitLike[] = splits;
        const segmentRows = customSplits
          .filter((s) => s.segmentSubtype !== "roxzone")
          .map((s) => {
            const time = Math.round(parseFloat(s.timeSeconds));
            if (s.segmentType === "run") {
              const meters = s.distanceMeters ?? null;
              if (meters && meters > 0) {
                const pacePerKm = (time / meters) * 1000;
                return `- ${s.segmentLabel} (${meters}m): ${formatTime(time)} → ${formatRunPace(pacePerKm)}`;
              }
              return `- ${s.segmentLabel}: ${formatTime(time)} (no distance recorded)`;
            }
            // station
            const pace = formatStationPace(
              s.segmentLabel,
              time,
              s.distanceMeters ?? undefined,
              s.reps ?? undefined,
            );
            const specBits: string[] = [];
            if (s.distanceMeters) specBits.push(`${s.distanceMeters}m`);
            if (s.reps) specBits.push(`${s.reps} reps`);
            if (s.weightKg) specBits.push(`${parseFloat(s.weightKg)} kg`);
            const spec = specBits.length ? ` (${specBits.join(", ")})` : "";
            return `- ${s.segmentLabel}${spec}: ${formatTime(time)}${pace ? ` → ${pace}` : ""}`;
          })
          .join("\n");

        const extrapBlock = ex
          ? (() => {
              const stationLines = ex.stations
                .map((est) => {
                  const sourceLabel =
                    est.source === "scaled"
                      ? `scaled from ${est.actualSeconds}s @ ${
                          est.actualDistanceMeters ?? est.actualReps ?? "?"
                        }${est.actualReps ? " reps" : "m"} → canonical ${
                          est.canonicalDistanceMeters ?? est.canonicalReps ?? "?"
                        }${est.canonicalReps ? " reps" : "m"}`
                      : est.source === "prior_pr"
                        ? "from athlete's prior canonical PR"
                        : "from division P50";
                  return `  - ${est.station}: ${formatTime(est.estimatedSeconds)} (${sourceLabel})`;
                })
                .join("\n");
              const dropped =
                ex.droppedStations.length > 0
                  ? `- Stations NOT performed in this race (filled from prior PR or P50): ${ex.droppedStations.join(", ")}`
                  : "- No stations were skipped — every canonical station was performed (possibly at scaled distance/reps).";
              const paceNote =
                ex.paceSource === "measured"
                  ? `measured from this race's runs`
                  : `fallback (division Run-1 P50 — no runs recorded in this race)`;
              return `## Full-HYROX extrapolation (deterministic, NOT a prediction of fitness gain)
- Avg run pace used: ${formatRunPace(ex.avgRunPaceSecPerKm ?? 0)} (${paceNote})
- Canonical run total: ${formatTime(ex.runSeconds)} (${ex.canonicalRunSegments} × ${ex.canonicalRunDistanceM}m)
- Canonical station total: ${formatTime(ex.stationSeconds)}
- EXTRAPOLATED FULL-HYROX FINISH: ${formatLongTime(ex.totalSeconds)}
- Per-station estimate sources:
${stationLines}
${dropped}`;
            })()
          : "## Full-HYROX extrapolation\n- Not available (insufficient run/station data and no reference distribution for this division).";

        analysisSection = `## Custom race breakdown
${segmentRows}

## Pacing
${pacingLine}

${extrapBlock}`;

        projectionInstructions = `The "Projected finish" shown to the athlete is an EXTRAPOLATION — what a CANONICAL FULL HYROX would take at the pace they held in this custom race. It is NOT a prediction of improvement and is NOT a PR-eligible result. Your "projectedFinishAssumptions" text should explain (in 2-3 sentences) that the number assumes the athlete holds the observed pace across all 8×${numerics.extrapolation?.canonicalRunDistanceM ?? 1000}m runs and the canonical station distances/reps, and (if applicable) that skipped stations were filled from prior PRs or division P50. Do NOT call it a PR. Do NOT promise it as a goal time — frame it as "if you held this pace at full distance".`;
      } else {
        const losses: TimeLossEntry[] = numerics.timeLossRanking;
        const lossRows = losses
          .map(
            (l: TimeLossEntry) =>
              `- ${l.station}: lost ${l.secondsLost}s vs P25 (currently P${l.percentile})`,
          )
          .join("\n") || "- (no segments below P25 — athlete already strong across the board)";

        analysisSection = `## Top time-loss segments (deterministic, vs P25)
${lossRows}

## Pacing
${pacingLine}`;

        projectionInstructions = `The "Projected finish" shown to the athlete is current finish MINUS the top time-loss segments — i.e. "if you fix these, you finish here". Your "projectedFinishAssumptions" text should describe (in 2-3 sentences) WHAT improvements on which segments produce that number.`;
      }

      const systemPrompt = `You are an elite HYROX coach analyzing a single race result. The numbers are PRE-COMPUTED and provided. Your job is qualitative analysis only — DO NOT recompute or restate numbers in the headline (the UI shows them). Output JSON only — no markdown, no explanation.

Rules:
- ${projectionInstructions}
- For custom races, "prioritizedFocus" should target weak per-segment paces or stations the athlete skipped (suggest building exposure to them). For canonical races, reflect the top time-loss segments above (you may bundle related stations e.g. Sled Push + Sled Pull into one focus).
- Tone guidance: ${toneGuidance}
- Be specific. "Improve burpee broad jumps" is too generic — say WHAT to work on (e.g. "explosive hip drive on the broad jump" or "smoother burpee → jump transition").
- Sessions per week: 1–3. Duration weeks: 2–8. Be realistic.
- The race format is ${race.template}. Do not refer to "additional stations" or "more stations" beyond what is listed above.`;

      const userPrompt = `## Race Summary
- Division: ${divisionKey}
- Template: ${race.template}
- Finish (as raced): ${formatLongTime(numerics.totalFinishSeconds)}
- Goal: ${goalLine}
- Race type: ${race.raceType}

${analysisSection}

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
  "projectedFinishAssumptions": "string — explanation per the rules above"
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
          projectionType: numerics.projectionType,
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
