// POST /api/support — send a support message via Resend (spec §3.5).
//
// Two variants:
//   - "gym-owner": routes to communities.admin_email; falls back to gym
//     admins' user emails when null.
//   - "bug-report": routes to shredstacksarah@gmail.com (per CLAUDE.md).
//
// Each message embeds user_id + active gym + a free-form recent_route
// the client passed for triage context.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { communities, communityMemberships, users } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { sendEmail } from "@/lib/email";
import { SupportMessageEmail } from "@/emails/support-message";

const BUG_REPORT_DESTINATION = "shredstacksarah@gmail.com";

type Variant = "gym-owner" | "bug-report";

export async function POST(req: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    variant?: Variant;
    subject?: string;
    message?: string;
    recentRoute?: string;
  } | null;

  if (!body?.variant || (body.variant !== "gym-owner" && body.variant !== "bug-report")) {
    return NextResponse.json({ error: "Invalid variant" }, { status: 400 });
  }
  const subject = (body.subject ?? "").trim();
  const message = (body.message ?? "").trim();
  if (!subject) {
    return NextResponse.json({ error: "Subject is required" }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }
  if (message.length > 10_000) {
    return NextResponse.json(
      { error: "Message is too long" },
      { status: 400 }
    );
  }

  const [me] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      activeCommunityId: users.activeCommunityId,
    })
    .from(users)
    .where(eq(users.id, sessionUser.id))
    .limit(1);
  if (!me) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  let activeGymName: string | undefined;
  let activeGymId: string | undefined;
  if (me.activeCommunityId) {
    const [c] = await db
      .select({
        id: communities.id,
        name: communities.name,
        adminEmail: communities.adminEmail,
      })
      .from(communities)
      .where(eq(communities.id, me.activeCommunityId))
      .limit(1);
    if (c) {
      activeGymName = c.name;
      activeGymId = c.id;
    }
  }

  // Build the destination list.
  let to: string[];
  if (body.variant === "bug-report") {
    to = [BUG_REPORT_DESTINATION];
  } else {
    if (!me.activeCommunityId) {
      return NextResponse.json(
        { error: "You're not in a gym yet — message ShredTrack instead" },
        { status: 400 }
      );
    }
    const [community] = await db
      .select({
        id: communities.id,
        adminEmail: communities.adminEmail,
      })
      .from(communities)
      .where(eq(communities.id, me.activeCommunityId))
      .limit(1);
    if (!community) {
      return NextResponse.json({ error: "Gym not found" }, { status: 404 });
    }
    if (community.adminEmail) {
      to = [community.adminEmail];
    } else {
      // Fall back to active admin user emails for the gym.
      const adminRows = await db
        .select({ email: users.email })
        .from(communityMemberships)
        .innerJoin(users, eq(users.id, communityMemberships.userId))
        .where(
          and(
            eq(communityMemberships.communityId, community.id),
            eq(communityMemberships.isAdmin, true),
            eq(communityMemberships.isActive, true)
          )
        );
      to = adminRows.map((r) => r.email).filter(Boolean);
      if (to.length === 0) {
        return NextResponse.json(
          { error: "Your gym has no admin email on file" },
          { status: 400 }
        );
      }
    }
  }

  const recentRoute =
    typeof body.recentRoute === "string" && body.recentRoute.length < 256
      ? body.recentRoute
      : undefined;

  for (const dest of to) {
    await sendEmail({
      to: dest,
      subject: `[ShredTrack ${body.variant === "bug-report" ? "Bug" : "Member"}] ${subject}`,
      // Replies land in the sender's inbox, not the no-reply address.
      replyTo: me.email,
      react: SupportMessageEmail({
        subject,
        message,
        fromName: me.name,
        fromEmail: me.email,
        userId: me.id,
        activeGymName,
        activeGymId,
        recentRoute,
        variant: body.variant,
      }),
    });
  }

  return NextResponse.json({ ok: true, recipients: to.length });
}
