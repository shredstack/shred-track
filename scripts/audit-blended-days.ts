// One-shot dev script: list gym dates where both programmed sessions
// (programming_release_id set) and manual sessions (release id null)
// coexist. Pre-fix, the /api/gym/[id]/programming route grouped sessions
// by date only, so a manual session added via the CrossFit-tab workaround
// got silently merged into the programmed day's `sections[]`. The route
// is now fixed to bucket by (date, release_id); this script surfaces the
// historical blended days you may want to inspect / reconcile by hand.
//
// Usage:
//   npx tsx scripts/audit-blended-days.ts
//   npx tsx scripts/audit-blended-days.ts <communityId>
//
// Output: one line per blended day with the community id, date, the
// programmed sessions' release id + section kinds, and the manual
// session ids + kinds. Nothing is mutated.

import { config } from "dotenv";
config({ path: ".env.local" });

import { fileURLToPath } from "node:url";
import { eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { communities, workoutSessions } from "@/db/schema";

interface SessionRow {
  id: string;
  communityId: string;
  workoutDate: string;
  kind: string;
  position: number;
  programmingReleaseId: string | null;
  title: string | null;
}

async function findBlendedDays(filterCommunityId: string | null) {
  // Step 1: identify (community, date) pairs that have BOTH a manual and a
  // programmed session. SQL would do this in one shot but Drizzle's groupBy
  // typing for mixed conditional aggregates is awkward — two scans are
  // cheaper to write and the table is small.
  const baseCondition = filterCommunityId
    ? eq(workoutSessions.communityId, filterCommunityId)
    : isNotNull(workoutSessions.communityId);

  const allSessions = await db
    .select({
      id: workoutSessions.id,
      communityId: workoutSessions.communityId,
      workoutDate: workoutSessions.workoutDate,
      kind: workoutSessions.kind,
      position: workoutSessions.position,
      programmingReleaseId: workoutSessions.programmingReleaseId,
      title: workoutSessions.title,
    })
    .from(workoutSessions)
    .where(baseCondition);

  // Group by (community, date) → { programmed: [], manual: [] }
  const byKey = new Map<
    string,
    { programmed: SessionRow[]; manual: SessionRow[] }
  >();
  for (const s of allSessions) {
    if (!s.communityId) continue;
    const key = `${s.communityId}|${s.workoutDate}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { programmed: [], manual: [] };
      byKey.set(key, entry);
    }
    const row: SessionRow = {
      id: s.id,
      communityId: s.communityId,
      workoutDate: s.workoutDate,
      kind: s.kind,
      position: s.position,
      programmingReleaseId: s.programmingReleaseId,
      title: s.title,
    };
    if (s.programmingReleaseId) {
      entry.programmed.push(row);
    } else {
      entry.manual.push(row);
    }
  }

  const blended = Array.from(byKey.entries()).filter(
    ([, v]) => v.programmed.length > 0 && v.manual.length > 0
  );

  // Look up community names for friendlier output.
  const communityIds = Array.from(
    new Set(blended.map(([key]) => key.split("|")[0]))
  );
  const communityRows = communityIds.length
    ? await db
        .select({ id: communities.id, name: communities.name })
        .from(communities)
        .where(sql`${communities.id} = ANY(${communityIds})`)
    : [];
  const nameById = new Map(communityRows.map((c) => [c.id, c.name]));

  return { blended, nameById };
}

async function main() {
  const filterCommunityId = process.argv[2] ?? null;

  if (filterCommunityId) {
    console.log(`Scanning blended days for community ${filterCommunityId}…\n`);
  } else {
    console.log("Scanning all communities for blended days…\n");
  }

  const { blended, nameById } = await findBlendedDays(filterCommunityId);

  if (blended.length === 0) {
    console.log("No blended days found. Nothing to reconcile.");
    return;
  }

  console.log(`Found ${blended.length} blended day(s):\n`);
  for (const [key, { programmed, manual }] of blended) {
    const [communityId, date] = key.split("|");
    const name = nameById.get(communityId) ?? "(unknown)";
    console.log(`• ${name} (${communityId}) — ${date}`);
    const releaseIds = Array.from(
      new Set(programmed.map((r) => r.programmingReleaseId!).filter(Boolean))
    );
    console.log(
      `    programmed: ${programmed.length} session(s) [${programmed
        .map((r) => `${r.kind}@${r.position}`)
        .join(", ")}] release=${releaseIds.join(",")}`
    );
    console.log(
      `    manual:     ${manual.length} session(s) [${manual
        .map((r) => `${r.kind}@${r.position} ${r.id}`)
        .join(", ")}]`
    );
  }
  console.log("\nThese will now render with the programmed day in the");
  console.log("admin's main card AND a separate amber 'manual workouts'");
  console.log("banner. Review and either:");
  console.log("  - delete the manual sessions if they were the workaround");
  console.log("    (they live in workout_sessions; cascade-deletes their scores), OR");
  console.log("  - use 'Move into programming' to attach them to the day's release.");
}

// Allow direct invocation via tsx.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => process.exit(0));
}
