import { config } from "dotenv";
config({ path: ".env.local" });

import { gte } from "drizzle-orm";
import { fileURLToPath } from "url";

import { db } from "..";
import { scores } from "../schema";
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
//
// Uses the singleton `db` import to share a connection with
// refreshStrengthForUser (same singleton). A separate postgres() client
// here would double the seed's open connection count for no benefit.

export async function run() {
  const cutoff = strengthLookbackCutoff();
  const userRows = await db
    .selectDistinct({ userId: scores.userId })
    .from(scores)
    .where(gte(scores.createdAt, cutoff));

  if (userRows.length === 0) {
    console.log("athlete_movement_strength — no users with recent scores; nothing to do.");
    return;
  }

  let totalRefreshed = 0;
  let totalDeleted = 0;
  for (const u of userRows) {
    const { refreshed, deleted } = await refreshStrengthForUser(u.userId);
    totalRefreshed += refreshed;
    totalDeleted += deleted;
  }

  console.log(
    `athlete_movement_strength — users: ${userRows.length}, ` +
      `(movement, user) refreshed: ${totalRefreshed}, deleted: ${totalDeleted}`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
}
