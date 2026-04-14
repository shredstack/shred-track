import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db } from "@/db";
import { hyroxUserPredictions, hyroxProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { generatePrediction, savePrediction } from "@/lib/insights/predictor";

/**
 * GET /api/hyrox/predict
 * Returns the cached last prediction (no model run).
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [prediction] = await db
    .select()
    .from(hyroxUserPredictions)
    .where(eq(hyroxUserPredictions.userId, user.id));

  if (!prediction) {
    return NextResponse.json({ error: "No prediction found" }, { status: 404 });
  }

  return NextResponse.json({
    predictedFinishSeconds: prediction.predictedFinishSeconds,
    predictedFinishLow: prediction.predictedFinishLow,
    predictedFinishHigh: prediction.predictedFinishHigh,
    percentile: Number(prediction.predictedPercentile),
    confidence: Number(prediction.confidence),
    contributingSignals: prediction.contributingSignals,
    bottleneckStation: prediction.bottleneckStation,
    bottleneckSavingsSeconds: prediction.bottleneckSavingsSeconds,
    updatedAt: prediction.updatedAt.toISOString(),
  });
}

/**
 * POST /api/hyrox/predict
 * Runs the model and returns a fresh prediction. User-triggered only.
 */
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Get user's division
  const [profile] = await db
    .select()
    .from(hyroxProfiles)
    .where(eq(hyroxProfiles.userId, user.id));

  if (!profile) {
    return NextResponse.json(
      { error: "Complete your HYROX profile first" },
      { status: 400 },
    );
  }

  try {
    const result = await generatePrediction(user.id);
    await savePrediction(user.id, result, profile.targetDivision);

    return NextResponse.json({
      ...result,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Prediction error:", err);
    const message = err instanceof Error ? err.message : "Prediction failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
