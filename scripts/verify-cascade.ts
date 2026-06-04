// Verification script — runs the suggested-weight cascade against
// Sarah's real local DB for the Deadlift case to confirm:
//   (a) Tier 2 (logged_1rm) still wins when a logged 1RM exists (regression guard).
//   (b) The new movement_history tier fires when Sarah has prior history
//       on another template and no 1RM is on file (we strip the strength
//       row to simulate the no-1RM case, then restore it).
//
// Run: DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54352/postgres \
//      npx tsx scripts/verify-cascade.ts

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  athleteMovementStrength,
  crossfitWorkoutMovements,
  crossfitWorkoutParts,
  movements,
  users,
} from "@/db/schema";
import {
  loadMovementSuggestionInputs,
  suggestWeightsForPart,
  type PartSuggestionInput,
} from "@/lib/crossfit/suggested-weight";

async function main() {
  const SARAH_ID = "37af0f97-f0a3-42b8-b7d8-b97226145b05";
  const [u] = await db
    .select({ id: users.id, gender: users.gender })
    .from(users)
    .where(eq(users.id, SARAH_ID))
    .limit(1);
  if (!u) throw new Error("Sarah not found");
  console.log("User:", u);

  // Diane is a Deadlift WOD Sarah hasn't logged. Her existing logs are on
  // Deadlift skill work + Deadlift Day → tier 1 (same-template) is
  // skipped; tier 2 (logged_1rm) should win for the regression-guard case.
  const DIANE_ID = "7ca397d6-c6f0-438a-91d6-5852257e198a";

  await reportCascade(u, DIANE_ID, "Diane (Deadlift) — regression guard (1RM on file)");

  // Now simulate the dumbbell/kettlebell case: remove Sarah's Deadlift
  // strength row so tiers 2/3 fall through, then re-run. The new
  // movement_history tier should fire using her prior log on
  // Deadlift Day (the most recent qualifying template).
  console.log("\n--- Simulating no-1RM case: removing Deadlift strength row ---");
  const [deadlift] = await db
    .select({ id: movements.id })
    .from(movements)
    .where(eq(movements.canonicalName, "Deadlift"))
    .limit(1);
  const dlId = deadlift.id;

  const [strength] = await db
    .select()
    .from(athleteMovementStrength)
    .where(
      and(
        eq(athleteMovementStrength.userId, SARAH_ID),
        eq(athleteMovementStrength.movementId, dlId)
      )
    );

  try {
    await db
      .delete(athleteMovementStrength)
      .where(
        and(
          eq(athleteMovementStrength.userId, SARAH_ID),
          eq(athleteMovementStrength.movementId, dlId)
        )
      );

    await reportCascade(
      u,
      DIANE_ID,
      "Diane (Deadlift) — no-1RM simulation (movement_history expected)"
    );
  } finally {
    // Always restore — leave Sarah's data untouched.
    if (strength) {
      await db.insert(athleteMovementStrength).values(strength);
      console.log("\nRestored Deadlift strength row.");
    }
  }

  process.exit(0);
}

async function reportCascade(
  user: { id: string; gender: string | null },
  templateId: string,
  label: string
) {
  const parts = await db
    .select()
    .from(crossfitWorkoutParts)
    .where(eq(crossfitWorkoutParts.crossfitWorkoutId, templateId));

  console.log(`\n=== ${label} ===`);
  for (const part of parts) {
    const cwmRows = await db
      .select({ id: crossfitWorkoutMovements.id, name: movements.canonicalName })
      .from(crossfitWorkoutMovements)
      .innerJoin(movements, eq(movements.id, crossfitWorkoutMovements.movementId))
      .where(eq(crossfitWorkoutMovements.crossfitWorkoutPartId, part.id));

    const inputs = await loadMovementSuggestionInputs(cwmRows.map((r) => r.id));
    const partInput: PartSuggestionInput = {
      workoutType: part.workoutType,
      timeCapSeconds: part.timeCapSeconds,
      amrapDurationSeconds: part.amrapDurationSeconds,
      emomIntervalSeconds: part.emomIntervalSeconds,
      rounds: part.rounds,
      repScheme: part.repScheme,
      intervalRounds: (part.intervalRounds ?? null) as PartSuggestionInput["intervalRounds"],
      intervalWorkSeconds: part.intervalWorkSeconds,
      intervalRestSeconds: part.intervalRestSeconds,
      movementCategories: inputs.map((i) => i.movementCategory),
      movements: inputs,
    };

    const out = await suggestWeightsForPart(user, partInput);
    for (const m of cwmRows) {
      const s = out.get(m.id);
      console.log(
        `  ${m.name}: ${s?.method} (${s?.confidence}) ${s?.lowLb}–${s?.highLb} lb`
      );
      if (s?.priorContext) {
        console.log(`    priorContext:`, JSON.stringify(s.priorContext));
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
