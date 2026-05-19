// ---------------------------------------------------------------------------
// GymTheme — server-rendered <style> tag that overrides --primary with the
// active gym's brand color.
//
// Runs in the app layout so the override is inlined into the initial HTML
// payload, avoiding the flash of un-themed content the spec called out.
// Client-side gym switches refresh this via Next's full-page revalidation
// path (the layout re-renders when the activeCommunityId changes).
//
// Falls back silently if:
//   - the user has no active gym (personal mode)
//   - the active gym has no primary_color set
//   - the primary_color isn't a valid hex
// ---------------------------------------------------------------------------

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { communities, users } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import {
  deriveForegroundOklch,
  formatOklch,
  hexToOklch,
} from "@/lib/color";

export async function GymTheme() {
  const user = await getSessionUser();
  if (!user) return null;

  const [row] = await db
    .select({
      activeCommunityId: users.activeCommunityId,
    })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  if (!row?.activeCommunityId) return null;

  const [gym] = await db
    .select({ primaryColor: communities.primaryColor })
    .from(communities)
    .where(eq(communities.id, row.activeCommunityId))
    .limit(1);

  if (!gym?.primaryColor) return null;
  const primary = hexToOklch(gym.primaryColor);
  if (!primary) return null;
  const foreground = deriveForegroundOklch(primary);

  // Scoped to :root so it overrides both light and dark theme defaults.
  // Targeting both --primary and --ring (which uses the same color in the
  // existing theme) keeps focus rings + chart-1 aligned.
  const css = `:root { --primary: ${formatOklch(primary)}; --primary-foreground: ${formatOklch(foreground)}; --ring: ${formatOklch(primary)}; --chart-1: ${formatOklch(primary)}; --sidebar-primary: ${formatOklch(primary)}; --sidebar-primary-foreground: ${formatOklch(foreground)}; --sidebar-ring: ${formatOklch(primary)}; }`;

  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
