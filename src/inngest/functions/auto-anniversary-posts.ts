// auto-anniversary-posts (spec §2.3 + §3.8)
//
// Runs once an hour. For each gym, if the *current local time* is in the
// 6am hour, find:
//   (a) members whose gym_anniversary_date.month_day matches today
//       (anniversary post)
//   (b) members whose users.date_of_birth.month_day matches today
//       (birthday post — PR 3 §3.8 extension)
// Generate a short post via Claude Haiku with the system prompt cached,
// insert as status='pending_review' for coach review.
//
// Hourly rather than daily so we hit each gym's 6am-local window without
// having to know per-gym timezones ahead of cron firing.

import Anthropic from "@anthropic-ai/sdk";
import { and, eq, sql } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "@/db";
import {
  communities,
  communityMemberships,
  gymPosts,
  users,
} from "@/db/schema";

const ANNIVERSARY_PROMPT = `You are a CrossFit gym's encouragement writer.
You produce ONE short, warm anniversary post (1-2 sentences, max 200 chars)
celebrating a member's anniversary at their gym.

Style guide:
- Speak to the gym community, not to the member directly (third person).
- Mention the member by first name and the years they've been at the gym.
- Include one celebratory emoji at the start. No hashtags.
- Match the energy of a community whiteboard: warm but not saccharine,
  short, scannable.

Examples of tone:
🎉 Big shout-out to Sarah — 3 years at CrossFit Draper this week. Keep showing up.
🔥 5 years for Mike at the gym today. The work compounds. Cheers to him.

Output only the post body. No preamble, no quotes.`;

const BIRTHDAY_PROMPT = `You are a CrossFit gym's encouragement writer.
You produce ONE short, warm birthday post (1-2 sentences, max 200 chars)
celebrating a member's birthday for the gym community to see.

Style guide:
- Speak to the gym community, not to the member directly (third person).
- Mention the member by first name. Do NOT include their age unless
  explicitly provided.
- Include one celebratory emoji at the start. No hashtags.
- Match the energy of a community whiteboard: warm but not saccharine,
  short, scannable.

Examples of tone:
🎂 Wish Sarah a happy birthday today at CrossFit Draper. Big year ahead.
🎉 Birthday shout-out for Mike — gym fam, send the love.

Output only the post body. No preamble, no quotes.`;

const ANNIVERSARY_SYSTEM_BLOCK = [
  {
    type: "text" as const,
    text: ANNIVERSARY_PROMPT,
    cache_control: { type: "ephemeral" as const },
  },
];

const BIRTHDAY_SYSTEM_BLOCK = [
  {
    type: "text" as const,
    text: BIRTHDAY_PROMPT,
    cache_control: { type: "ephemeral" as const },
  },
];

export const autoAnniversaryPosts = inngest.createFunction(
  {
    id: "social-auto-anniversary-posts",
    retries: 1,
    triggers: [{ cron: "0 * * * *" }], // every hour on the hour
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ step }: { step: any }) => {
    const enabled = process.env.AUTO_ANNIVERSARY_ENABLED?.toLowerCase() !== "false";
    if (!enabled) return { skipped: true };
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { skipped: "no-api-key" };

    const now = new Date();

    const gyms = (await step.run("list-gyms", async () =>
      db
        .select({
          id: communities.id,
          name: communities.name,
          timezone: communities.gymTimezone,
        })
        .from(communities)
    )) as Array<{ id: string; name: string; timezone: string }>;

    const client = new Anthropic({ apiKey });
    const summaries: Array<{
      communityId: string;
      created: number;
      birthdays: number;
    }> = [];

    for (const gym of gyms) {
      const gymLocalHour = hourInTz(now, gym.timezone);
      if (gymLocalHour !== 6) continue;
      const monthDay = monthDayInTz(now, gym.timezone);

      const candidates = (await step.run(
        `find-candidates-${gym.id}`,
        async () =>
          db
            .select({
              userId: communityMemberships.userId,
              userName: users.name,
              anniversaryDate: communityMemberships.gymAnniversaryDate,
              joinedAt: communityMemberships.joinedAt,
            })
            .from(communityMemberships)
            .innerJoin(users, eq(users.id, communityMemberships.userId))
            .where(
              and(
                eq(communityMemberships.communityId, gym.id),
                eq(communityMemberships.isActive, true),
                // month-day match
                sql`to_char(${communityMemberships.gymAnniversaryDate}, 'MM-DD') = ${monthDay}`
              )
            )
      )) as Array<{
        userId: string;
        userName: string;
        anniversaryDate: string;
        joinedAt: Date;
      }>;

      let created = 0;
      for (const c of candidates) {
        // Compute years since anniversary date.
        const yrs = yearsSince(c.anniversaryDate, now);
        if (yrs < 1) continue;
        // Skip if an anniversary post already exists for this member today.
        const existing = (await step.run(
          `check-existing-${gym.id}-${c.userId}`,
          async () => {
            const rows = await db
              .select({ id: gymPosts.id })
              .from(gymPosts)
              .where(
                and(
                  eq(gymPosts.communityId, gym.id),
                  eq(gymPosts.authorId, c.userId),
                  eq(gymPosts.kind, "auto_anniversary"),
                  sql`${gymPosts.createdAt} > now() - interval '20 hours'`
                )
              )
              .limit(1);
            return rows[0] ?? null;
          }
        )) as { id: string } | null;
        if (existing) continue;

        const body = (await step.run(
          `generate-${gym.id}-${c.userId}`,
          async () => {
            const firstName = c.userName.split(/\s+/)[0];
            const userPrompt = `Member first name: ${firstName}
Years at the gym: ${yrs}
Gym name: ${gym.name}`;
            const resp = await client.messages.create({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 200,
              system: ANNIVERSARY_SYSTEM_BLOCK,
              messages: [{ role: "user", content: userPrompt }],
            });
            const block = resp.content.find((b) => b.type === "text");
            if (!block || block.type !== "text") return null;
            return block.text.trim();
          }
        )) as string | null;
        if (!body) continue;

        await step.run(
          `insert-${gym.id}-${c.userId}`,
          async () => {
            await db.insert(gymPosts).values({
              communityId: gym.id,
              authorId: c.userId,
              kind: "auto_anniversary",
              status: "pending_review",
              body,
              mentionedUserIds: [c.userId],
            });
          }
        );
        created++;
      }

      // Birthday auto-posts (PR 3 §3.8). Same gym 6am window. Match on
      // users.date_of_birth.month_day. The DOB column is optional — solo
      // users and members who haven't filled it in are simply skipped.
      const birthdayCandidates = (await step.run(
        `find-birthdays-${gym.id}`,
        async () =>
          db
            .select({
              userId: users.id,
              userName: users.name,
              dateOfBirth: users.dateOfBirth,
            })
            .from(communityMemberships)
            .innerJoin(users, eq(users.id, communityMemberships.userId))
            .where(
              and(
                eq(communityMemberships.communityId, gym.id),
                eq(communityMemberships.isActive, true),
                sql`${users.dateOfBirth} IS NOT NULL`,
                sql`to_char(${users.dateOfBirth}, 'MM-DD') = ${monthDay}`
              )
            )
      )) as Array<{
        userId: string;
        userName: string;
        dateOfBirth: string | null;
      }>;

      let birthdays = 0;
      for (const b of birthdayCandidates) {
        const existing = (await step.run(
          `check-bday-${gym.id}-${b.userId}`,
          async () => {
            const rows = await db
              .select({ id: gymPosts.id })
              .from(gymPosts)
              .where(
                and(
                  eq(gymPosts.communityId, gym.id),
                  eq(gymPosts.authorId, b.userId),
                  eq(gymPosts.kind, "auto_birthday"),
                  sql`${gymPosts.createdAt} > now() - interval '20 hours'`
                )
              )
              .limit(1);
            return rows[0] ?? null;
          }
        )) as { id: string } | null;
        if (existing) continue;

        const body = (await step.run(
          `generate-bday-${gym.id}-${b.userId}`,
          async () => {
            const firstName = b.userName.split(/\s+/)[0];
            const userPrompt = `Member first name: ${firstName}
Gym name: ${gym.name}`;
            const resp = await client.messages.create({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 200,
              system: BIRTHDAY_SYSTEM_BLOCK,
              messages: [{ role: "user", content: userPrompt }],
            });
            const block = resp.content.find((b) => b.type === "text");
            if (!block || block.type !== "text") return null;
            return block.text.trim();
          }
        )) as string | null;
        if (!body) continue;

        await step.run(`insert-bday-${gym.id}-${b.userId}`, async () => {
          await db.insert(gymPosts).values({
            communityId: gym.id,
            authorId: b.userId,
            kind: "auto_birthday",
            status: "pending_review",
            body,
            mentionedUserIds: [b.userId],
          });
        });
        birthdays++;
      }

      summaries.push({
        communityId: gym.id,
        created,
        birthdays,
      });
    }

    return { gyms: gyms.length, summaries };
  }
);

function hourInTz(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const h = parts.find((p) => p.type === "hour")!.value;
  return Number(h) % 24;
}

function monthDayInTz(at: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${m}-${d}`;
}

function yearsSince(iso: string, now: Date): number {
  const start = new Date(`${iso}T00:00:00Z`);
  const yrs = now.getUTCFullYear() - start.getUTCFullYear();
  // If we haven't reached the anniversary month-day yet this year, subtract 1.
  const startMd =
    (start.getUTCMonth() + 1) * 100 + start.getUTCDate();
  const nowMd = (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
  return nowMd >= startMd ? yrs : yrs - 1;
}
