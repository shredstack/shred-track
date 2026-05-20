// Public invite landing — /g/<slug>
//
// Logged-out visitors see a themed marketing page (logo + gym name + sign
// up CTA). Logged-in users get auto-joined (if the gym's
// auto_join_via_link is enabled) and bounced to /home; if auto-join is
// disabled, they see a "Use a join code" CTA.

import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  communities,
  communityMemberships,
  users,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import {
  deriveForegroundOklch,
  formatOklch,
  hexToOklch,
} from "@/lib/color";
import { hasRequiredOnJoinDocs } from "@/lib/documents";

interface GymLanding {
  id: string;
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
  websiteUrl: string | null;
  autoJoinViaLink: boolean;
}

async function loadGymBySlug(slug: string): Promise<GymLanding | null> {
  const [row] = await db
    .select({
      id: communities.id,
      name: communities.name,
      logoUrl: communities.logoUrl,
      primaryColor: communities.primaryColor,
      websiteUrl: communities.websiteUrl,
      autoJoinViaLink: communities.autoJoinViaLink,
    })
    .from(communities)
    .where(eq(communities.inviteUrlSlug, slug.toLowerCase()))
    .limit(1);
  return row ?? null;
}

function gymThemeStyle(primaryHex: string | null): string | null {
  if (!primaryHex) return null;
  const primary = hexToOklch(primaryHex);
  if (!primary) return null;
  const fg = deriveForegroundOklch(primary);
  return `:root { --primary: ${formatOklch(primary)}; --primary-foreground: ${formatOklch(fg)}; --ring: ${formatOklch(primary)}; }`;
}

export default async function GymInviteLandingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const gym = await loadGymBySlug(slug);

  if (!gym) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center">
        <div className="max-w-sm space-y-2">
          <h1 className="text-xl font-bold">Unknown invite link</h1>
          <p className="text-sm text-muted-foreground">
            That gym&apos;s invite link doesn&apos;t look right. Double-check
            the URL or ask your coach for a join code.
          </p>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Go to ShredTrack
          </Link>
        </div>
      </div>
    );
  }

  const sessionUser = await getSessionUser();

  // Logged-in path: auto-join if allowed, else surface the join code CTA.
  if (sessionUser) {
    if (gym.autoJoinViaLink) {
      const requiresDocs = await hasRequiredOnJoinDocs(gym.id);
      const [existing] = await db
        .select({ id: communityMemberships.id, isActive: communityMemberships.isActive })
        .from(communityMemberships)
        .where(eq(communityMemberships.userId, sessionUser.id))
        .limit(1);

      // Insert or reactivate (best-effort; the join-by-slug API handles the
      // same flow if this server path fails).
      const [memberRow] = await db
        .select({ id: communityMemberships.id })
        .from(communityMemberships)
        .where(eq(communityMemberships.communityId, gym.id))
        .limit(1);

      if (existing && memberRow) {
        // already a member; only reactivate when no doc gate stands in
        // the way. If doc gate is on, leave isActive as-is — the sign
        // flow will flip it after signatures land.
        if (!existing.isActive && !requiresDocs) {
          await db
            .update(communityMemberships)
            .set({ isActive: true, deactivatedAt: null })
            .where(eq(communityMemberships.id, existing.id));
        }
      } else {
        await db
          .insert(communityMemberships)
          .values({
            communityId: gym.id,
            userId: sessionUser.id,
            accountId: sessionUser.id,
            isAdmin: false,
            isCoach: false,
            isActive: !requiresDocs,
          })
          .onConflictDoNothing();
      }

      await db
        .update(users)
        .set({ activeCommunityId: gym.id, updatedAt: new Date() })
        .where(eq(users.id, sessionUser.id));

      redirect(requiresDocs ? `/g/${slug}/sign-documents` : "/crossfit");
    }
  }

  const themeCss = gymThemeStyle(gym.primaryColor);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {themeCss ? <style dangerouslySetInnerHTML={{ __html: themeCss }} /> : null}
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
        <div className="space-y-6 text-center">
          {gym.logoUrl ? (
            <Image
              src={gym.logoUrl}
              alt={`${gym.name} logo`}
              width={120}
              height={120}
              className="mx-auto h-28 w-28 rounded-2xl object-contain"
              priority
              unoptimized
            />
          ) : (
            <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-2xl bg-primary/20 text-3xl font-bold text-primary">
              {gym.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="space-y-2">
            <h1 className="text-3xl font-bold">{gym.name}</h1>
            <p className="text-sm text-muted-foreground">
              Welcome. Sign up to join {gym.name} on ShredTrack — track your
              workouts, log scores, and see today&apos;s WOD.
            </p>
          </div>

          <div className="space-y-2">
            {sessionUser ? (
              <Link
                href="/crossfit"
                className="block w-full rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground"
              >
                Continue to ShredTrack
              </Link>
            ) : (
              <>
                <Link
                  href={`/signup?invite=${encodeURIComponent(slug)}`}
                  className="block w-full rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground"
                >
                  Sign up
                </Link>
                <Link
                  href={`/login?invite=${encodeURIComponent(slug)}`}
                  className="block w-full rounded-md border border-border px-4 py-3 text-sm font-medium"
                >
                  I already have an account
                </Link>
              </>
            )}
          </div>

          {gym.websiteUrl ? (
            <a
              href={gym.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-xs text-muted-foreground underline"
            >
              Visit {gym.name} on the web →
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
