// ---------------------------------------------------------------------------
// Smoke test — runs the end-to-end plan creation path directly against the
// DB (skipping HTTP + auth) so we can verify copy logic without a browser.
//
// Usage: npx tsx src/lib/hyrox-generic-plans/smoke-test.ts <user_id>
// ---------------------------------------------------------------------------

import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, asc, eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import { resolvePlanDates } from "./race-date";

async function main() {
  const userId = process.argv[2];
  if (!userId) {
    console.error("Usage: npx tsx src/lib/hyrox-generic-plans/smoke-test.ts <user_id>");
    process.exit(1);
  }

  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(client, { schema });

  // ---- Case 1: No race date (start today) ----
  console.log("\n=== Case 1: No race date ===");
  let resolution = resolvePlanDates(null);
  console.log("Resolution:", resolution);

  // ---- Case 2: Race 18 weeks out ----
  console.log("\n=== Case 2: Race 20 weeks out ===");
  const twentyWeeksOut = new Date(Date.now() + 20 * 7 * 24 * 60 * 60 * 1000);
  // find the next Saturday after that date
  const day = twentyWeeksOut.getUTCDay();
  const toSat = (6 - day + 7) % 7;
  twentyWeeksOut.setUTCDate(twentyWeeksOut.getUTCDate() + toSat);
  const raceDateFar = twentyWeeksOut.toISOString().slice(0, 10);
  console.log("Race date:", raceDateFar);
  resolution = resolvePlanDates(raceDateFar);
  console.log("Resolution:", resolution);

  // ---- Case 3: Race 15 weeks out (compressed) ----
  console.log("\n=== Case 3: Race 15 weeks out (compression) ===");
  const fifteenWeeksOut = new Date(Date.now() + 15 * 7 * 24 * 60 * 60 * 1000);
  const day2 = fifteenWeeksOut.getUTCDay();
  const toSat2 = (6 - day2 + 7) % 7;
  fifteenWeeksOut.setUTCDate(fifteenWeeksOut.getUTCDate() + toSat2);
  const raceDateMid = fifteenWeeksOut.toISOString().slice(0, 10);
  console.log("Race date:", raceDateMid);
  resolution = resolvePlanDates(raceDateMid);
  console.log("Resolution:", resolution);

  // ---- Case 4: Race 10 weeks out (should fail) ----
  console.log("\n=== Case 4: Race 10 weeks out (should 422) ===");
  const tenWeeksOut = new Date(Date.now() + 10 * 7 * 24 * 60 * 60 * 1000);
  const day3 = tenWeeksOut.getUTCDay();
  const toSat3 = (6 - day3 + 7) % 7;
  tenWeeksOut.setUTCDate(tenWeeksOut.getUTCDate() + toSat3);
  const raceDateNear = tenWeeksOut.toISOString().slice(0, 10);
  console.log("Race date:", raceDateNear);
  resolution = resolvePlanDates(raceDateNear);
  console.log("Resolution:", resolution);

  // ---- Case 5: End-to-end DB copy (no race date) ----
  console.log("\n=== Case 5: End-to-end DB copy (women_singles_intermediate_open) ===");
  const dateResult = resolvePlanDates(null);
  if (!dateResult.ok) throw new Error("Unexpected: case 1 failed");
  const { startTemplateWeek, totalWeeks, startDate, endDate } = dateResult.resolution;

  const [template] = await db
    .select()
    .from(schema.hyroxGenericPlanTemplates)
    .where(
      and(
        eq(schema.hyroxGenericPlanTemplates.templateKey, "women_singles_intermediate"),
        eq(schema.hyroxGenericPlanTemplates.weightTier, "open"),
      ),
    )
    .limit(1);

  if (!template) {
    throw new Error("Template not found — did you run db:seed:hyrox-generic-plans?");
  }

  console.log("Found template:", template.title);

  const tPhases = await db
    .select()
    .from(schema.hyroxGenericPlanTemplatePhases)
    .where(eq(schema.hyroxGenericPlanTemplatePhases.templateId, template.id))
    .orderBy(asc(schema.hyroxGenericPlanTemplatePhases.phaseNumber));

  const tSessions = await db
    .select()
    .from(schema.hyroxGenericPlanTemplateSessions)
    .where(eq(schema.hyroxGenericPlanTemplateSessions.templateId, template.id));

  console.log(`Template has ${tPhases.length} phases, ${tSessions.length} sessions`);

  const startedAt = Date.now();
  const planId = await db.transaction(async (tx) => {
    // Archive old plans
    await tx
      .update(schema.hyroxTrainingPlans)
      .set({ status: "archived" })
      .where(
        and(
          eq(schema.hyroxTrainingPlans.userId, userId),
          eq(schema.hyroxTrainingPlans.status, "active"),
        ),
      );

    const [plan] = await tx
      .insert(schema.hyroxTrainingPlans)
      .values({
        userId,
        title: template.title,
        totalWeeks,
        startDate,
        endDate,
        planType: "generic",
        status: "active",
        paceScaleFactor: "1.0",
        generationStatus: "completed",
        trainingPhilosophy: { summary: template.trainingPhilosophy, templateVersion: template.version },
      })
      .returning({ id: schema.hyroxTrainingPlans.id });

    const includedPhases = tPhases.filter((p) => p.endWeek >= startTemplateWeek);
    const insertedPhases = await tx
      .insert(schema.hyroxPlanPhases)
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
      .returning({ id: schema.hyroxPlanPhases.id, phaseNumber: schema.hyroxPlanPhases.phaseNumber });

    const phaseIdByNumber = new Map(insertedPhases.map((p) => [p.phaseNumber, p.id]));

    const includedSessions = tSessions.filter((s) => s.week >= startTemplateWeek);
    for (let i = 0; i < includedSessions.length; i += 200) {
      await tx.insert(schema.hyroxPlanSessions).values(
        includedSessions.slice(i, i + 200).map((s) => ({
          planId: plan.id,
          week: s.week - startTemplateWeek + 1,
          dayOfWeek: s.dayOfWeek,
          sessionType: s.sessionType,
          title: s.title,
          description: s.description,
          targetPace: null,
          durationMinutes: s.durationMinutes,
          phase: `Phase ${s.phaseNumber}`,
          orderInDay: s.orderInDay,
          phaseId: phaseIdByNumber.get(s.phaseNumber) ?? null,
          aiGenerated: false,
          athleteModified: false,
          sessionDetail: s.sessionDetail,
          equipmentRequired: s.equipmentRequired,
        })),
      );
    }

    return plan.id;
  });
  const elapsedMs = Date.now() - startedAt;
  console.log(`✓ Plan copied in ${elapsedMs}ms. Plan ID: ${planId}`);

  // Verify
  const phases = await db
    .select()
    .from(schema.hyroxPlanPhases)
    .where(eq(schema.hyroxPlanPhases.planId, planId));
  const sessions = await db
    .select()
    .from(schema.hyroxPlanSessions)
    .where(eq(schema.hyroxPlanSessions.planId, planId));
  console.log(`  Created ${phases.length} phases and ${sessions.length} sessions for the plan.`);

  // Clean up: archive this test plan so it doesn't pollute the user's state
  await db
    .update(schema.hyroxTrainingPlans)
    .set({ status: "archived" })
    .where(eq(schema.hyroxTrainingPlans.id, planId));
  console.log(`  (Plan archived to clean up.)`);

  await client.end();
  console.log("\n✓ Smoke test complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
