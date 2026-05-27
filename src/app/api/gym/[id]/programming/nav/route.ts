// GET /api/gym/[id]/programming/nav?weekStart=YYYY-MM-DD
//
// Auxiliary data for the programming week header:
//   - `surrounding`: ±3 weeks around `weekStart`, each tagged with its
//     release status so the mini week strip can color the dots.
//   - `nextEmptyBackward` / `nextEmptyForward`: the nearest week (in
//     either direction) that has no release row at all. Used for the
//     "jump to next empty week" shortcut, which matters for coaches
//     backfilling many months at a time.
//
// "Empty" = no programming_releases row exists for that week. A draft
// counts as not-empty even if it has no sections yet — the coach has
// already engaged with that week.

import { NextRequest, NextResponse } from "next/server";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { programmingReleases } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";

const SURROUNDING_WEEKS = 3; // ±N

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type ReleaseStatus = "published" | "draft" | "empty";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: communityId } = await params;
  if (!(await canManageGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const weekStart = url.searchParams.get("weekStart");
  if (!weekStart || !isIsoDate(weekStart)) {
    return NextResponse.json(
      { error: "weekStart must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const rangeStart = addDays(weekStart, -7 * SURROUNDING_WEEKS);
  const rangeEnd = addDays(weekStart, 7 * SURROUNDING_WEEKS);

  // Fetch every release that overlaps the strip window in one shot, then
  // build the per-week status map client-side. Cheaper than 7 separate
  // queries.
  const rows = await db
    .select({
      weekStart: programmingReleases.weekStart,
      status: programmingReleases.status,
    })
    .from(programmingReleases)
    .where(
      and(
        eq(programmingReleases.communityId, communityId),
        gte(programmingReleases.weekStart, rangeStart),
        lte(programmingReleases.weekStart, rangeEnd)
      )
    );

  const byWeek = new Map<string, "published" | "draft">();
  for (const r of rows) {
    byWeek.set(r.weekStart, r.status === "published" ? "published" : "draft");
  }

  const surrounding: { weekStart: string; status: ReleaseStatus }[] = [];
  for (let i = -SURROUNDING_WEEKS; i <= SURROUNDING_WEEKS; i++) {
    const ws = addDays(weekStart, i * 7);
    surrounding.push({ weekStart: ws, status: byWeek.get(ws) ?? "empty" });
  }

  // Next-empty pointers. We need the *closest* week in each direction
  // that is missing a release. Strategy: walk outward from `weekStart`
  // until we find a gap. To bound the walk, fetch every release in a
  // generous window (±104 weeks ≈ 2 years) and detect gaps in JS. If
  // the entire window is fully programmed, we report null (the coach
  // can step further manually).
  const SEARCH_WEEKS = 104;
  const searchStart = addDays(weekStart, -7 * SEARCH_WEEKS);
  const searchEnd = addDays(weekStart, 7 * SEARCH_WEEKS);

  const allRows = await db
    .select({ weekStart: programmingReleases.weekStart })
    .from(programmingReleases)
    .where(
      and(
        eq(programmingReleases.communityId, communityId),
        gte(programmingReleases.weekStart, searchStart),
        lte(programmingReleases.weekStart, searchEnd)
      )
    );

  const programmedSet = new Set(allRows.map((r) => r.weekStart));

  let nextEmptyBackward: string | null = null;
  for (let i = 1; i <= SEARCH_WEEKS; i++) {
    const ws = addDays(weekStart, -7 * i);
    if (!programmedSet.has(ws)) {
      nextEmptyBackward = ws;
      break;
    }
  }

  let nextEmptyForward: string | null = null;
  for (let i = 1; i <= SEARCH_WEEKS; i++) {
    const ws = addDays(weekStart, 7 * i);
    if (!programmedSet.has(ws)) {
      nextEmptyForward = ws;
      break;
    }
  }

  // Earliest *programmed* week — useful to anchor the "oldest gap is
  // before X" UI hint if the coach has clearly been backfilling.
  const [earliest] = await db
    .select({ weekStart: programmingReleases.weekStart })
    .from(programmingReleases)
    .where(eq(programmingReleases.communityId, communityId))
    .orderBy(asc(programmingReleases.weekStart))
    .limit(1);

  const [latest] = await db
    .select({ weekStart: programmingReleases.weekStart })
    .from(programmingReleases)
    .where(eq(programmingReleases.communityId, communityId))
    .orderBy(desc(programmingReleases.weekStart))
    .limit(1);

  return NextResponse.json({
    weekStart,
    surrounding,
    nextEmptyBackward,
    nextEmptyForward,
    earliestProgrammedWeek: earliest?.weekStart ?? null,
    latestProgrammedWeek: latest?.weekStart ?? null,
  });
}
