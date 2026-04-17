/**
 * HYROX Finish Time Predictor — server-side logic.
 *
 * Combines:
 * 1. Synthetic finish time (station times + run paces + fatigue + transitions)
 * 2. ML model correction (LightGBM via pure-JS tree walker)
 * 3. Confidence-weighted blend
 */

import { db } from "@/db";
import {
  hyroxProfiles,
  hyroxStationAssessments,
  hyroxStationBenchmarks,
  hyroxSessionLogs,
  hyroxPredictorModels,
  hyroxUserPredictions,
} from "@/db/schema";
import { eq, and, desc, sql, count } from "drizzle-orm";
import { STATION_ORDER, type DivisionKey, REFERENCE_TIMES, RUN_REFERENCE, ROXZONE_REFERENCE, RUN_REFERENCES_BY_SEGMENT } from "@/lib/hyrox-data";
import { predict, loadModel } from "./tree-predictor";

// Fade factors: average run slowdown from Run 1 → Run k, derived from public data.
// Placeholder values — will be refined from actual aggregates after first scrape.
const FADE_FACTORS: Partial<Record<DivisionKey, number[]>> = {
  men_open:   [1.00, 1.02, 1.04, 1.06, 1.08, 1.10, 1.13, 1.18],
  women_open: [1.00, 1.02, 1.05, 1.07, 1.09, 1.12, 1.15, 1.20],
  men_pro:    [1.00, 1.01, 1.03, 1.05, 1.07, 1.09, 1.11, 1.15],
  women_pro:  [1.00, 1.01, 1.03, 1.05, 1.07, 1.09, 1.12, 1.16],
};

// Fallback transition allowance when no scraped roxzone data is available
const DEFAULT_TRANSITION_SECONDS = 6 * 20 + 2 * 30;

interface UserFeatures {
  stationTimes: Map<string, number>;
  runPaceSecsPerKm: number | null;
  sessionCount: number;
  avgRpe: number | null;
  previousRaceCount: number;
  bestFinishTimeSeconds: number | null;
  divisionKey: DivisionKey;
}

interface PredictionResult {
  predictedFinishSeconds: number;
  predictedFinishLow: number;
  predictedFinishHigh: number;
  percentile: number;
  confidence: number;
  contributingSignals: Record<string, unknown>;
  bottleneckStation: string | null;
  bottleneckSavingsSeconds: number | null;
  modelVersion: string;
}

/**
 * Gather the user's feature vector from their logged data.
 */
export async function gatherUserFeatures(userId: string): Promise<UserFeatures | null> {
  // Profile
  const [profile] = await db
    .select()
    .from(hyroxProfiles)
    .where(eq(hyroxProfiles.userId, userId));

  if (!profile) return null;

  const divisionKey = profile.targetDivision as DivisionKey;

  // Station benchmarks (latest per station)
  const benchmarks = await db
    .select()
    .from(hyroxStationBenchmarks)
    .where(eq(hyroxStationBenchmarks.userId, userId))
    .orderBy(desc(hyroxStationBenchmarks.loggedAt));

  const stationTimes = new Map<string, number>();
  for (const b of benchmarks) {
    if (!stationTimes.has(b.station)) {
      stationTimes.set(b.station, b.timeSeconds);
    }
  }

  // Station assessments as fallback
  const assessments = await db
    .select()
    .from(hyroxStationAssessments)
    .where(eq(hyroxStationAssessments.profileId, profile.id));

  for (const a of assessments) {
    if (a.currentTimeSeconds && !stationTimes.has(a.station)) {
      stationTimes.set(a.station, a.currentTimeSeconds);
    }
  }

  // Run pace
  let runPaceSecsPerKm: number | null = null;
  if (profile.moderatePaceSecondsPerUnit) {
    runPaceSecsPerKm = profile.paceUnit === "mile"
      ? Math.round(profile.moderatePaceSecondsPerUnit / 1.60934)
      : profile.moderatePaceSecondsPerUnit;
  }

  // Session count + avg RPE
  const sessionStats = await db
    .select({
      count: count(),
      avgRpe: sql<number>`AVG(${hyroxSessionLogs.rpe})::float`,
    })
    .from(hyroxSessionLogs)
    .where(eq(hyroxSessionLogs.userId, userId));

  const sessionCount = sessionStats[0]?.count ?? 0;
  const avgRpe = sessionStats[0]?.avgRpe ?? null;

  return {
    stationTimes,
    runPaceSecsPerKm,
    sessionCount,
    avgRpe,
    previousRaceCount: profile.previousRaceCount,
    bestFinishTimeSeconds: profile.bestFinishTimeSeconds,
    divisionKey,
  };
}

/**
 * Compute a synthetic finish time from user data + division medians.
 */
function computeSyntheticFinish(features: UserFeatures): number {
  const refTimes = REFERENCE_TIMES[features.divisionKey];
  const perRunRefs = RUN_REFERENCES_BY_SEGMENT[features.divisionKey];
  const fadeFactors = FADE_FACTORS[features.divisionKey] ?? [1, 1.02, 1.04, 1.06, 1.08, 1.10, 1.13, 1.18];
  const runRef = RUN_REFERENCE[features.divisionKey] ?? [240, 300, 420];
  const transitionSeconds = ROXZONE_REFERENCE[features.divisionKey]?.[1] ?? DEFAULT_TRANSITION_SECONDS;

  // Station times: use user's benchmark or division median (index 1)
  let stationTotal = 0;
  for (const station of STATION_ORDER) {
    const userTime = features.stationTimes.get(station);
    stationTotal += userTime ?? refTimes?.[station]?.[1] ?? 300;
  }

  // Run times: prefer per-run medians when user has no pace, else apply fade to user pace
  const basePace = features.runPaceSecsPerKm;
  let runTotal = 0;
  for (let i = 0; i < 8; i++) {
    if (basePace) {
      runTotal += Math.round(basePace * fadeFactors[i]);
    } else {
      const runLabel = `Run ${i + 1}`;
      runTotal += perRunRefs?.[runLabel]?.[1] ?? Math.round((runRef[1]) * fadeFactors[i]);
    }
  }

  return stationTotal + runTotal + transitionSeconds;
}

/**
 * Compute confidence score (0-1) based on data completeness.
 */
function computeConfidence(features: UserFeatures): number {
  let score = 0;
  const stationCoverage = features.stationTimes.size / STATION_ORDER.length;
  score += stationCoverage * 0.3; // 30% weight on station benchmarks

  if (features.runPaceSecsPerKm) score += 0.2;
  if (features.sessionCount >= 10) score += 0.15;
  else if (features.sessionCount >= 5) score += 0.1;
  else if (features.sessionCount > 0) score += 0.05;

  if (features.previousRaceCount > 0) score += 0.15;
  if (features.bestFinishTimeSeconds) score += 0.1;
  if (features.avgRpe) score += 0.1;

  return Math.min(1, Math.round(score * 100) / 100);
}

/**
 * Build the feature array for ML model inference.
 * Features: 8 station times + 8 run times + 5 derived ratios = 21 features.
 */
function buildFeatureVector(features: UserFeatures): number[] {
  const refTimes = REFERENCE_TIMES[features.divisionKey];
  const perRunRefs = RUN_REFERENCES_BY_SEGMENT[features.divisionKey];
  const runRef = RUN_REFERENCE[features.divisionKey] ?? [240, 300, 420];
  const fadeFactors = FADE_FACTORS[features.divisionKey] ?? [1, 1.02, 1.04, 1.06, 1.08, 1.10, 1.13, 1.18];
  const basePace = features.runPaceSecsPerKm;

  // 8 station times
  const stationFeats = STATION_ORDER.map((s) =>
    features.stationTimes.get(s) ?? refTimes?.[s]?.[1] ?? 300,
  );

  // 8 run times — use per-run medians when no user pace available
  const runFeats = fadeFactors.map((f, i) => {
    if (basePace) return Math.round(basePace * f);
    const runLabel = `Run ${i + 1}`;
    return perRunRefs?.[runLabel]?.[1] ?? Math.round(runRef[1] * f);
  });

  // 5 derived ratios
  const sledPush = stationFeats[1]; // Sled Push
  const sledPull = stationFeats[2]; // Sled Pull
  const burpees = stationFeats[3];  // Burpee Broad Jumps
  const wallBalls = stationFeats[7]; // Wall Balls
  const skiErg = stationFeats[0];   // SkiErg
  const rowing = stationFeats[4];   // Rowing
  const farmers = stationFeats[5];  // Farmers Carry
  const lunges = stationFeats[6];   // Sandbag Lunges

  const ratios = [
    sledPull > 0 ? sledPush / sledPull : 1,
    runFeats[7] > 0 ? runFeats[0] / runFeats[7] : 1,
    wallBalls > 0 ? burpees / wallBalls : 1,
    rowing > 0 ? skiErg / rowing : 1,
    lunges > 0 ? farmers / lunges : 1,
  ];

  return [...stationFeats, ...runFeats, ...ratios];
}

/**
 * Find the bottleneck station — the one where improving to p25 saves the most time.
 */
async function findBottleneck(
  features: UserFeatures,
): Promise<{ station: string; savings: number } | null> {
  // Get p25 values from the materialized view
  const rows = await db.execute(sql`
    SELECT segment_label, p25::float as p25
    FROM hyrox_public_division_aggregates
    WHERE division_key = ${features.divisionKey}
    AND event_id IS NULL
    AND segment_type = 'station'
  `);

  const p25Map = new Map<string, number>();
  for (const row of rows as unknown as Array<{ segment_label: string; p25: number }>) {
    p25Map.set(row.segment_label, row.p25);
  }

  let maxSavings = 0;
  let bottleneckStation: string | null = null;

  for (const station of STATION_ORDER) {
    const userTime = features.stationTimes.get(station);
    const p25 = p25Map.get(station);
    if (!userTime || !p25) continue;

    const savings = userTime - p25;
    if (savings > maxSavings) {
      maxSavings = savings;
      bottleneckStation = station;
    }
  }

  if (!bottleneckStation || maxSavings <= 0) return null;
  return { station: bottleneckStation, savings: Math.round(maxSavings) };
}

/**
 * Main prediction function — called from POST /api/hyrox/predict.
 */
export async function generatePrediction(userId: string): Promise<PredictionResult> {
  const features = await gatherUserFeatures(userId);
  if (!features) {
    throw new Error("No HYROX profile found. Complete onboarding first.");
  }

  const confidence = computeConfidence(features);
  const syntheticFinish = computeSyntheticFinish(features);

  // Try to load and run the ML model
  let mlFinish: number | null = null;
  let mlFinishLow: number | null = null;
  let mlFinishHigh: number | null = null;
  let modelVersion = "synthetic-only";

  const [activeModel] = await db
    .select()
    .from(hyroxPredictorModels)
    .where(
      and(
        eq(hyroxPredictorModels.divisionKey, features.divisionKey),
        eq(hyroxPredictorModels.modelType, "gbm_finish_time"),
        eq(hyroxPredictorModels.isActive, true),
      ),
    );

  if (activeModel?.artifactUrl) {
    try {
      const featureVector = buildFeatureVector(features);
      const model = await loadModel(activeModel.artifactUrl);
      mlFinish = Math.round(predict(model, featureVector));
      modelVersion = activeModel.id;

      // Load quantile models for confidence interval
      const [q10Model] = await db
        .select()
        .from(hyroxPredictorModels)
        .where(
          and(
            eq(hyroxPredictorModels.divisionKey, features.divisionKey),
            eq(hyroxPredictorModels.modelType, "gbm_finish_time_q10"),
            eq(hyroxPredictorModels.isActive, true),
          ),
        );
      const [q90Model] = await db
        .select()
        .from(hyroxPredictorModels)
        .where(
          and(
            eq(hyroxPredictorModels.divisionKey, features.divisionKey),
            eq(hyroxPredictorModels.modelType, "gbm_finish_time_q90"),
            eq(hyroxPredictorModels.isActive, true),
          ),
        );

      if (q10Model?.artifactUrl) {
        const m = await loadModel(q10Model.artifactUrl);
        mlFinishLow = Math.round(predict(m, featureVector));
      }
      if (q90Model?.artifactUrl) {
        const m = await loadModel(q90Model.artifactUrl);
        mlFinishHigh = Math.round(predict(m, featureVector));
      }
    } catch (err) {
      console.error("ML model inference failed, falling back to synthetic:", err);
    }
  }

  // Blend synthetic + ML based on confidence
  // Higher confidence → more weight on ML; lower → more on synthetic
  const mlWeight = mlFinish != null ? Math.min(confidence, 0.7) : 0;
  const syntheticWeight = 1 - mlWeight;

  const predicted = Math.round(
    syntheticFinish * syntheticWeight + (mlFinish ?? syntheticFinish) * mlWeight,
  );

  // Confidence interval
  // If ML quantile models exist, blend them too; otherwise, use ±percentage based on confidence
  const spreadPct = 0.05 + (1 - confidence) * 0.1; // 5-15% spread
  const predictedLow = mlFinishLow != null
    ? Math.round(mlFinishLow * mlWeight + syntheticFinish * (1 - spreadPct) * syntheticWeight)
    : Math.round(predicted * (1 - spreadPct));
  const predictedHigh = mlFinishHigh != null
    ? Math.round(mlFinishHigh * mlWeight + syntheticFinish * (1 + spreadPct) * syntheticWeight)
    : Math.round(predicted * (1 + spreadPct));

  // Compute percentile from public data
  const percentileRows = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE finish_time_seconds <= ${predicted})::float /
      NULLIF(COUNT(*)::float, 0) * 100 AS percentile
    FROM hyrox_public_results
    WHERE division_key = ${features.divisionKey}
    AND is_dnf = false
  `);
  const percentile = (percentileRows as unknown as Array<{ percentile: number }>)[0]?.percentile ?? 50;

  // Bottleneck
  const bottleneck = await findBottleneck(features);

  // Contributing signals for transparency
  const contributingSignals = {
    stationsCovered: features.stationTimes.size,
    totalStations: STATION_ORDER.length,
    hasRunPace: !!features.runPaceSecsPerKm,
    sessionCount: features.sessionCount,
    previousRaceCount: features.previousRaceCount,
    hasBestFinish: !!features.bestFinishTimeSeconds,
    syntheticFinishSeconds: syntheticFinish,
    mlFinishSeconds: mlFinish,
    mlWeight: Math.round(mlWeight * 100),
  };

  return {
    predictedFinishSeconds: predicted,
    predictedFinishLow: predictedLow,
    predictedFinishHigh: predictedHigh,
    percentile: Math.round(percentile * 100) / 100,
    confidence,
    contributingSignals,
    bottleneckStation: bottleneck?.station ?? null,
    bottleneckSavingsSeconds: bottleneck?.savings ?? null,
    modelVersion,
  };
}

/**
 * Upsert prediction into hyrox_user_predictions.
 */
export async function savePrediction(
  userId: string,
  prediction: PredictionResult,
  divisionKey: string,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO hyrox_user_predictions
      (id, user_id, division_key, predicted_finish_seconds, predicted_finish_low,
       predicted_finish_high, predicted_percentile, confidence,
       contributing_signals, bottleneck_station, bottleneck_savings_seconds,
       model_version, updated_at)
    VALUES
      (gen_random_uuid(), ${userId}, ${divisionKey},
       ${prediction.predictedFinishSeconds}, ${prediction.predictedFinishLow},
       ${prediction.predictedFinishHigh}, ${prediction.percentile},
       ${prediction.confidence}, ${JSON.stringify(prediction.contributingSignals)}::jsonb,
       ${prediction.bottleneckStation}, ${prediction.bottleneckSavingsSeconds},
       ${prediction.modelVersion}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      division_key = EXCLUDED.division_key,
      predicted_finish_seconds = EXCLUDED.predicted_finish_seconds,
      predicted_finish_low = EXCLUDED.predicted_finish_low,
      predicted_finish_high = EXCLUDED.predicted_finish_high,
      predicted_percentile = EXCLUDED.predicted_percentile,
      confidence = EXCLUDED.confidence,
      contributing_signals = EXCLUDED.contributing_signals,
      bottleneck_station = EXCLUDED.bottleneck_station,
      bottleneck_savings_seconds = EXCLUDED.bottleneck_savings_seconds,
      model_version = EXCLUDED.model_version,
      updated_at = NOW()
  `);
}
