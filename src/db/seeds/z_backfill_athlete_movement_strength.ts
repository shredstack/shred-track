import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { gte, eq, sql } from "drizzle-orm";
import { fileURLToPath } from "url";
import * as schema from "../schema";
import { refreshStrengthForUser, strengthLookbackCutoff } from "../../lib/crossfit/strength-updater";

// ============================================
// z_backfill_athlete_movement_strength
// ============================================
//
// One-shot backfill of athlete_movement_strength from historical scores.
// Idempotent: refreshStrengthForUser upserts; re-running converges.
//
// Filename prefix `z_` keeps this after the stimulus_profiles seed so the
// suggested-weight engine has band data available the moment a strength
// row exists.
//
// Only runs over users who have logged at least one score in the lookback
// window — pre-filters here so a fresh DB with no scores no-ops cheaply.

export async function run() {
  const client = postgres(process.env.DATABASE_URL!);
  const db = drizzle(client, { schema });

  try {
    const cutoff = strengthLookbackCutoff();
    const userRows = await db
      .selectDistinct({ userId: schema.scores.userId })
      .from(schema.scores)
      .where(gte(schema.scores.createdAt, cutoff));

    if (userRows.length === 0) {
      console.log("athlete_movement_strength — no users with recent scores; nothing to do.");
      return;
    }

    let totalRefreshed = 0;
    let totalDeleted = 0;
    for (const u of userRows) {
      // refreshStrengthForUser uses the singleton @/db connection. We've
      // already set DATABASE_URL above so it'll bind to the same DB.
      const { refreshed, deleted } = await refreshStrengthForUser(u.userId);
      totalRefreshed += refreshed;
      totalDeleted += deleted;
    }

    console.log(
      `athlete_movement_strength — users: ${userRows.length}, ` +
        `(movement, user) refreshed: ${totalRefreshed}, deleted: ${totalDeleted}`
    );
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
}
