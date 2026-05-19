// /g/<slug>/sign-documents — sign-on-join + re-sign flow (PR 3 §3.2).
//
// Server-rendered shell: resolves the gym slug, confirms the user has a
// membership row (active or pending), and hands off the actual signing
// UI to a client component that reads the pending list from
// `/api/communities/[id]/pending-documents`.

import { redirect, notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { communities, communityMemberships } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { SignDocumentsClient } from "./sign-documents-client";

export default async function SignDocumentsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const user = await getSessionUser();
  if (!user) redirect(`/login?next=/g/${slug}/sign-documents`);

  const [gym] = await db
    .select({ id: communities.id, name: communities.name })
    .from(communities)
    .where(eq(communities.inviteUrlSlug, slug.toLowerCase()))
    .limit(1);
  if (!gym) notFound();

  const [membership] = await db
    .select({ id: communityMemberships.id })
    .from(communityMemberships)
    .where(
      and(
        eq(communityMemberships.communityId, gym.id),
        eq(communityMemberships.userId, user.id)
      )
    )
    .limit(1);
  if (!membership) redirect(`/g/${slug}`);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-8">
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          {gym.name}
        </p>
        <h1 className="text-2xl font-bold">Documents to sign</h1>
        <p className="text-sm text-muted-foreground">
          Review and sign each document below to finish joining.
        </p>
      </div>
      <SignDocumentsClient communityId={gym.id} gymName={gym.name} />
    </div>
  );
}
