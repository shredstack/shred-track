// /gym/[gymSlug]/display/[date]
//
// Full-screen TV display (spec §1.9). One section per slide. Keyboard nav:
// ArrowRight / Space → next section, ArrowLeft → prev, ArrowDown → next
// day, ArrowUp → prev day.
//
// Gating: the caller must be signed in AND have coach-or-admin access to
// the gym referenced by the slug. The route is publicly addressable but
// renders a "Sign in" prompt for unauthorized viewers — the full kiosk
// sign-in flow with long-lived cookie lands in a follow-up.

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  communities,
  workoutSessions,
  type WorkoutSectionKind,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";
import { isFlagOn } from "@/lib/feature-flags";
import {
  deriveForegroundOklch,
  formatOklch,
  hexToOklch,
} from "@/lib/color";
import { DisplayClient } from "./display-client";

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

interface SectionForDisplay {
  id: string;
  kind: WorkoutSectionKind;
  position: number;
  title: string | null;
  body: string;
}

async function loadForDate(
  communityId: string,
  date: string
): Promise<SectionForDisplay[]> {
  // Unified-schema: sections ARE workout_sessions. Pull every published
  // session for the gym + date.
  const sectionRows = await db
    .select({
      id: workoutSessions.id,
      kind: workoutSessions.kind,
      position: workoutSessions.position,
      title: workoutSessions.title,
    })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.communityId, communityId),
        eq(workoutSessions.workoutDate, date),
        eq(workoutSessions.published, true)
      )
    )
    .orderBy(asc(workoutSessions.position));
  if (sectionRows.length === 0) return [];

  return sectionRows.map((s) => ({
    id: s.id,
    kind: s.kind as WorkoutSectionKind,
    position: s.position,
    title: s.title,
    body: s.title ?? "",
  }));
}

function gymThemeStyle(primaryHex: string | null): string | null {
  if (!primaryHex) return null;
  const primary = hexToOklch(primaryHex);
  if (!primary) return null;
  const fg = deriveForegroundOklch(primary);
  return `:root { --primary: ${formatOklch(primary)}; --primary-foreground: ${formatOklch(fg)}; --ring: ${formatOklch(primary)}; }`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function DisplayPage({
  params,
}: {
  params: Promise<{ gymSlug: string; date: string }>;
}) {
  const { gymSlug, date } = await params;
  if (!isIsoDate(date)) {
    return (
      <Centered>
        <p className="text-2xl">Invalid date. Expected YYYY-MM-DD.</p>
      </Centered>
    );
  }

  const [gym] = await db
    .select({
      id: communities.id,
      name: communities.name,
      primaryColor: communities.primaryColor,
      logoUrl: communities.logoUrl,
    })
    .from(communities)
    .where(eq(communities.inviteUrlSlug, gymSlug.toLowerCase()))
    .limit(1);

  if (!gym) {
    return (
      <Centered>
        <p className="text-2xl">Unknown gym.</p>
      </Centered>
    );
  }

  // Flag gate: TV display is per-gym opt-in.
  if (!(await isFlagOn("class_display_mode", { communityId: gym.id }))) {
    return (
      <Centered>
        <p className="text-2xl">
          TV display isn&apos;t enabled for this gym yet.
        </p>
      </Centered>
    );
  }

  const user = await getSessionUser();
  if (!user) {
    return (
      <Centered>
        <h1 className="text-4xl font-bold">{gym.name}</h1>
        <p className="text-xl text-muted-foreground">
          Sign in on this browser to display today&apos;s class.
        </p>
        <a
          href={`/login?next=${encodeURIComponent(`/gym/${gymSlug}/display/${date}`)}`}
          className="rounded-md bg-primary px-6 py-3 text-lg font-medium text-primary-foreground"
        >
          Sign in
        </a>
      </Centered>
    );
  }

  if (!(await canManageGym(user.id, gym.id))) {
    return (
      <Centered>
        <p className="text-2xl">
          You need coach access to {gym.name} to display this view.
        </p>
      </Centered>
    );
  }

  const sections = await loadForDate(gym.id, date);
  const themeCss = gymThemeStyle(gym.primaryColor);
  const prevDay = addDays(date, -1);
  const nextDay = addDays(date, 1);

  return (
    <>
      {themeCss ? <style dangerouslySetInnerHTML={{ __html: themeCss }} /> : null}
      <DisplayClient
        gymName={gym.name}
        gymLogoUrl={gym.logoUrl}
        gymSlug={gymSlug}
        date={date}
        prevDayPath={`/gym/${gymSlug}/display/${prevDay}`}
        nextDayPath={`/gym/${gymSlug}/display/${nextDay}`}
        sections={sections}
      />
    </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-12 text-center">
      {children}
    </div>
  );
}
