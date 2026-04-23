// ---------------------------------------------------------------------------
// Seed script — writes all 40 generic plan template variants into the DB.
//
// Idempotent by (template_key, weight_tier). On re-run, existing templates
// are deleted (cascade to phases + sessions) and rebuilt from the current
// renderer output. This is the right behavior when iterating on plan
// content — users' *plans* (which are copies of templates) are untouched.
//
// Usage:
//   npm run db:seed:hyrox-generic-plans
// ---------------------------------------------------------------------------

import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, inArray } from "drizzle-orm";

import * as schema from "./schema";
import { allTemplateVariants } from "@/lib/hyrox-generic-plans";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set; add it to .env.local");
  }
  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });

  const variants = allTemplateVariants();
  console.log(`Rendered ${variants.length} template variants — writing to DB…`);

  const startedAt = Date.now();
  let templateCount = 0;
  let phaseCount = 0;
  let sessionCount = 0;

  for (const v of variants) {
    // Delete existing rows for this (template_key, weight_tier).
    // Cascade on template_id FK cleans phases + sessions.
    const existing = await db
      .select({ id: schema.hyroxGenericPlanTemplates.id })
      .from(schema.hyroxGenericPlanTemplates)
      .where(
        and(
          eq(schema.hyroxGenericPlanTemplates.templateKey, v.templateKey),
          eq(schema.hyroxGenericPlanTemplates.weightTier, v.weightTier),
        ),
      );
    if (existing.length > 0) {
      await db
        .delete(schema.hyroxGenericPlanTemplates)
        .where(
          inArray(
            schema.hyroxGenericPlanTemplates.id,
            existing.map((r) => r.id),
          ),
        );
    }

    // Insert template
    const [template] = await db
      .insert(schema.hyroxGenericPlanTemplates)
      .values({
        templateKey: v.templateKey,
        gender: v.gender,
        raceFormat: v.raceFormat,
        paceTier: v.paceTier,
        weightTier: v.weightTier,
        totalWeeks: v.totalWeeks,
        title: v.title,
        trainingPhilosophy: v.trainingPhilosophy,
        version: 1,
      })
      .returning({ id: schema.hyroxGenericPlanTemplates.id });
    templateCount++;

    // Insert phases
    if (v.phases.length > 0) {
      await db.insert(schema.hyroxGenericPlanTemplatePhases).values(
        v.phases.map((p) => ({
          templateId: template.id,
          phaseNumber: p.phaseNumber,
          name: p.name,
          description: p.description,
          startWeek: p.startWeek,
          endWeek: p.endWeek,
          focusAreas: p.focusAreas,
        })),
      );
      phaseCount += v.phases.length;
    }

    // Insert sessions (batched in chunks of 100 — Postgres has a limit per statement)
    const batches = chunk(v.sessions, 100);
    for (const batch of batches) {
      await db.insert(schema.hyroxGenericPlanTemplateSessions).values(
        batch.map((s) => ({
          templateId: template.id,
          week: s.week,
          dayOfWeek: s.dayOfWeek,
          orderInDay: s.orderInDay,
          sessionType: s.sessionType,
          title: s.title,
          description: s.description,
          paceSpec: s.paceSpec ?? null,
          durationMinutes: s.durationMinutes,
          sessionDetail: s.sessionDetail,
          equipmentRequired: s.equipmentRequired,
          phaseNumber: s.phaseNumber,
        })),
      );
      sessionCount += batch.length;
    }

    console.log(
      `  ✓ ${v.templateKey} (${v.weightTier}) — ${v.phases.length} phases, ${v.sessions.length} sessions`,
    );
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `\nSeeded ${templateCount} templates, ${phaseCount} phases, ${sessionCount} sessions in ${elapsed}s.`,
  );

  await client.end();
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
