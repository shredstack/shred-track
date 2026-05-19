// /gym/programming/[weekStart]
//
// Per-week programming editor. Renders 7 day cards with their typed
// sections inline; coach can add/edit/remove sections, paste a CAP week,
// and flip the release from draft → published.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { communities, users } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { redirect } from "next/navigation";
import { ProgrammingWeekView } from "@/components/gym/programming/programming-week-view";
import { isFlagOn } from "@/lib/feature-flags";

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export default async function ProgrammingWeekPage({
  params,
}: {
  params: Promise<{ weekStart: string }>;
}) {
  const { weekStart } = await params;
  if (!isIsoDate(weekStart)) redirect("/gym/programming");

  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [row] = await db
    .select({ activeCommunityId: users.activeCommunityId })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!row?.activeCommunityId) redirect("/");

  const [gym] = await db
    .select({
      id: communities.id,
      name: communities.name,
      gymTimezone: communities.gymTimezone,
    })
    .from(communities)
    .where(eq(communities.id, row.activeCommunityId))
    .limit(1);

  // Gate this whole experience on the gym_programming flag — coaches of
  // gyms where the flag is off shouldn't see it.
  const flagOn = await isFlagOn("gym_programming", {
    userId: user.id,
    communityId: gym?.id,
  });
  if (!flagOn) {
    return (
      <div className="space-y-2 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Programming isn&apos;t enabled for this gym yet. Ask an admin to flip
        the <code>gym_programming</code> flag in /admin/feature-flags.
      </div>
    );
  }

  const capPasteOn = await isFlagOn("cap_paste_import", {
    userId: user.id,
    communityId: gym?.id,
  });

  return (
    <ProgrammingWeekView
      communityId={gym!.id}
      gymName={gym!.name}
      gymTimezone={gym!.gymTimezone}
      weekStart={weekStart}
      capPasteEnabled={capPasteOn}
    />
  );
}
