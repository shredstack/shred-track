// Dependents / family-membership helpers.
//
// Spec: claude_code_instructions/cfd_readiness/dependents_spec.md
//
// Three intertwined concepts (spec §1):
//   - users           : the auth identity (may be is_shadow = true)
//   - community_memberships : "this user is a member of this gym"
//   - family_members  : "this user is the dependent of that account holder
//                       in this gym"
//
// A dependent is always all three. The functions in this file are the
// only path through which family_members rows should be created /
// promoted / merged — they keep the three tables in sync.

import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { resolveGymTimezone } from "@/lib/timezone";

// Helpers that can be invoked either at the top level (`db`) or inside
// an existing transaction (`db.transaction(async (tx) => …)`). Drizzle's
// db type and tx type aren't assignable to each other, so use the
// intersection of the methods we actually call. `Parameters<…>[0]`
// extracts the tx parameter type from the transaction callback.
type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
import {
  communities,
  communityMemberships,
  documentSignatures,
  familyInvites,
  familyMembers,
  hyroxProfiles,
  hyroxSessionLogs,
  scores,
  trackDayScores,
  users,
  type FamilyRelationship,
} from "@/db/schema";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Shadow-user email pattern — collision-safe + never deliverable. */
const SHADOW_EMAIL_DOMAIN = "shredtrack-shadow.local";

/** Activation token lifetime (spec §4.5). */
export const ACTIVATION_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Family-invite token lifetime (consent flow §3.3 step 4). */
export const FAMILY_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Minor / adult derivation (spec §3.4)
// ---------------------------------------------------------------------------

/**
 * Extract today's calendar (year, month, day) in a given timezone.
 * We avoid the `new Date(date.toLocaleString(…))` round-trip because
 * that re-parses the formatted string in the runner's local tz —
 * fine when the runner *is* the gym, very wrong when it isn't.
 */
function calendarPartsInTz(
  tz: string,
  at: Date = new Date()
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/**
 * Parse a "YYYY-MM-DD" date string into calendar parts without any
 * timezone interpretation. Avoids "2008-01-15" being read as midnight
 * UTC (which then shifts to 2008-01-14 in negative-offset zones).
 */
function parseDobParts(
  dob: Date | string | null
): { year: number; month: number; day: number } | null {
  if (!dob) return null;
  if (typeof dob === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob);
    if (m) {
      return {
        year: Number(m[1]),
        month: Number(m[2]),
        day: Number(m[3]),
      };
    }
    const d = new Date(dob);
    if (Number.isNaN(d.getTime())) return null;
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
    };
  }
  return {
    year: dob.getUTCFullYear(),
    month: dob.getUTCMonth() + 1,
    day: dob.getUTCDate(),
  };
}

/**
 * True if `dateOfBirth` represents someone under 18 in `gymTimezone`.
 *
 * Reason gym tz matters: a kid in Denver who turns 18 at midnight local
 * should not be a minor when the server (UTC) reads the row at
 * 11:30 pm local. The legal/waiver context is the gym's jurisdiction.
 *
 * `dateOfBirth = null` returns false (treat as adult by default).
 * The UI should require DOB for any minor-adjacent action so we don't
 * silently fall through to the riskier default.
 */
export function isMinor(
  dateOfBirth: Date | string | null,
  gymTimezone: string
): boolean {
  const dob = parseDobParts(dateOfBirth);
  if (!dob) return false;

  const today = calendarPartsInTz(gymTimezone);
  // Compare today's calendar date to the 18th birthday's calendar date.
  // (Y, M, D) lexicographic compare — no Date arithmetic, no DST drift.
  const b = { year: dob.year + 18, month: dob.month, day: dob.day };
  if (today.year !== b.year) return today.year < b.year;
  if (today.month !== b.month) return today.month < b.month;
  return today.day < b.day;
}

/** Convert DOB to age in whole years at gym-local "today". */
export function ageInGymTz(
  dateOfBirth: Date | string | null,
  gymTimezone: string
): number | null {
  const dob = parseDobParts(dateOfBirth);
  if (!dob) return null;
  const today = calendarPartsInTz(gymTimezone);
  let age = today.year - dob.year;
  if (
    today.month < dob.month ||
    (today.month === dob.month && today.day < dob.day)
  ) {
    age--;
  }
  return age;
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

/**
 * 32-byte URL-safe token. Crypto-random; collisions are astronomically
 * unlikely and there's a unique index on the columns that use this.
 */
export function generateToken(): string {
  // randomUUID gives 122 bits of entropy — sufficient for single-use
  // links. Strip the dashes so it round-trips cleanly in URLs.
  return randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
}

/** Synthetic email used while a dependent is shadow-only. */
export function generateShadowEmail(): string {
  // 8 hex chars from randomUUID — enough to avoid collisions against the
  // unique constraint on users.email without bloating the row.
  const tag = randomUUID().replace(/-/g, "").slice(0, 8);
  return `shadow+${tag}@${SHADOW_EMAIL_DOMAIN}`;
}

/** True if `email` is a synthetic shadow address (never deliverable). */
export function isShadowEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.endsWith(`@${SHADOW_EMAIL_DOMAIN}`);
}

// ---------------------------------------------------------------------------
// Invariant assertions
// ---------------------------------------------------------------------------

/**
 * Spec §3.2 invariant: every community_memberships row either self-pays
 * (account_id = user_id) or has a matching family_members row pointing
 * at the account holder in the same gym.
 *
 * Call this at the end of any transaction that mutates family_members
 * or community_memberships.account_id. Throws on violation so the
 * surrounding transaction rolls back.
 */
export async function assertAccountConsistency(
  communityId: string,
  userId: string,
  // Drizzle's tx type is awkward to import; accept either the global db
  // or a transaction handle.
  tx: DbOrTx = db
): Promise<void> {
  const [membership] = await tx
    .select({
      userId: communityMemberships.userId,
      accountId: communityMemberships.accountId,
    })
    .from(communityMemberships)
    .where(
      and(
        eq(communityMemberships.communityId, communityId),
        eq(communityMemberships.userId, userId)
      )
    )
    .limit(1);
  if (!membership) return; // No membership = nothing to assert.

  if (membership.accountId === membership.userId) return; // Self-pay.

  // Otherwise must have a matching family_members row.
  const [link] = await tx
    .select({ id: familyMembers.id })
    .from(familyMembers)
    .where(
      and(
        eq(familyMembers.communityId, communityId),
        eq(familyMembers.dependentUserId, membership.userId),
        eq(familyMembers.accountHolderUserId, membership.accountId)
      )
    )
    .limit(1);

  if (!link) {
    throw new Error(
      `Account consistency violation: community_memberships row for user ${userId} in gym ${communityId} has account_id ${membership.accountId} but no matching family_members link`
    );
  }
}

// ---------------------------------------------------------------------------
// Shadow lifecycle
// ---------------------------------------------------------------------------

export interface CreateShadowDependentInput {
  accountHolderUserId: string;
  communityId: string;
  firstName: string;
  lastName?: string | null;
  dateOfBirth?: Date | string | null;
  gender?: "male" | "female" | "other" | null;
  relationship: FamilyRelationship;
  /** Real email captured for future invite (optional). Stored on the
   *  shadow users.email column once provided; if null we use a synthetic
   *  shadow address so the unique constraint stays satisfied. */
  email?: string | null;
  notes?: string | null;
}

export interface ShadowDependentRow {
  familyMemberId: string;
  dependentUserId: string;
  membershipId: string;
}

/**
 * Create a shadow user + community_memberships row + family_members
 * row in a single transaction. The account holder must already be an
 * active member of the gym.
 */
export async function createShadowDependent(
  input: CreateShadowDependentInput
): Promise<ShadowDependentRow> {
  const displayName = [input.firstName.trim(), input.lastName?.trim()]
    .filter(Boolean)
    .join(" ");

  const realEmail = input.email?.trim().toLowerCase() || null;
  // Use the real email when supplied so future invite/notification flows
  // have somewhere to send to. Otherwise stash a synthetic address.
  const emailForUsers = realEmail ?? generateShadowEmail();

  // If a real email is given, verify it doesn't already belong to a
  // non-shadow user (spec §0 rule 7). A shadow address always passes
  // because it's freshly generated.
  if (realEmail) {
    const [collision] = await db
      .select({ id: users.id, isShadow: users.isShadow })
      .from(users)
      .where(eq(users.email, realEmail))
      .limit(1);
    if (collision && !collision.isShadow) {
      throw new Error(
        "EMAIL_BELONGS_TO_REAL_USER: use linkExistingUserAsDependent instead"
      );
    }
    if (collision && collision.isShadow) {
      // Another account holder already added a shadow with this email.
      // Refuse — they should resolve the duplicate manually.
      throw new Error("EMAIL_BELONGS_TO_EXISTING_SHADOW");
    }
  }

  return await db.transaction(async (tx) => {
    const [shadowUser] = await tx
      .insert(users)
      .values({
        email: emailForUsers,
        name: displayName,
        gender: input.gender ?? null,
        dateOfBirth: input.dateOfBirth
          ? typeof input.dateOfBirth === "string"
            ? input.dateOfBirth
            : input.dateOfBirth.toISOString().slice(0, 10)
          : null,
        isShadow: true,
        shadowCreatedByUserId: input.accountHolderUserId,
        shadowCreatedAt: new Date(),
      })
      .returning({ id: users.id });

    const [membership] = await tx
      .insert(communityMemberships)
      .values({
        communityId: input.communityId,
        userId: shadowUser.id,
        accountId: input.accountHolderUserId,
        isAdmin: false,
        isCoach: false,
        isActive: true,
      })
      .returning({ id: communityMemberships.id });

    const [fm] = await tx
      .insert(familyMembers)
      .values({
        communityId: input.communityId,
        accountHolderUserId: input.accountHolderUserId,
        dependentUserId: shadowUser.id,
        relationship: input.relationship,
        hasOwnLogin: false,
        notes: input.notes ?? null,
      })
      .returning({ id: familyMembers.id });

    await assertAccountConsistency(input.communityId, shadowUser.id, tx);

    return {
      familyMemberId: fm.id,
      dependentUserId: shadowUser.id,
      membershipId: membership.id,
    };
  });
}

// ---------------------------------------------------------------------------
// Soft delete (spec §3.3 edge case A + §4.4)
// ---------------------------------------------------------------------------

/**
 * Turn a shadow user into a "merged" placeholder — keeps the row (and
 * therefore historic score references) but rewrites the email to a
 * synthetic merged-shadow form so the original address is free for
 * future signups, and renames the user to make it visually obvious in
 * any admin tooling that it's no longer the active identity.
 */
export async function softDeleteShadowDependent(
  shadowUserId: string,
  tx: DbOrTx = db
): Promise<void> {
  const [u] = await tx
    .select({ id: users.id, name: users.name, isShadow: users.isShadow })
    .from(users)
    .where(eq(users.id, shadowUserId))
    .limit(1);
  if (!u) return;
  if (!u.isShadow) {
    throw new Error(
      `Refusing to soft-delete non-shadow user ${shadowUserId} — caller bug`
    );
  }

  const mergedEmail = `shadow-merged-${u.id}@${SHADOW_EMAIL_DOMAIN}`;
  const mergedName = u.name.endsWith(" (merged)") ? u.name : `${u.name} (merged)`;

  await tx
    .update(users)
    .set({
      email: mergedEmail,
      name: mergedName,
      isShadow: true,
      updatedAt: new Date(),
    })
    .where(eq(users.id, shadowUserId));
}

// ---------------------------------------------------------------------------
// Merge shadow → existing real user (spec §3.3 edge case A)
// ---------------------------------------------------------------------------

/**
 * Reassign rows that reference `shadowUserId` over to `realUserId`, then
 * soft-delete the shadow row. Handles the unique-constraint cases on
 * (someTable, userId) by preferring the real user's row when both exist.
 *
 * Not a full superset of every users.id reference in the schema —
 * focuses on the tables a shadow account is most likely to own:
 * scores, hyrox session/profile data, track-day scores, document
 * signatures, and family_members / community_memberships. Tables a
 * shadow can't write to (e.g. social posts) are skipped on the
 * assumption that they don't have rows pointing at a shadow.
 */
export async function mergeShadowIntoUser(
  shadowUserId: string,
  realUserId: string,
  txOrDb: DbOrTx = db
): Promise<void> {
  if (shadowUserId === realUserId) return;

  // If the caller already opened a transaction, run inline so a downstream
  // failure (e.g. the family_members activation update) rolls back the
  // merge too. Otherwise open our own transaction so the merge is atomic.
  const run = async (tx: DbOrTx) => {
    // Simple reassigns (no uniqueness conflicts).
    await tx
      .update(scores)
      .set({ userId: realUserId })
      .where(eq(scores.userId, shadowUserId));

    // hyrox_profiles is UNIQUE on user_id (1:1). If the real user
    // already has a profile, drop the shadow's — the real one wins.
    const [realHyrox] = await tx
      .select({ id: hyroxProfiles.userId })
      .from(hyroxProfiles)
      .where(eq(hyroxProfiles.userId, realUserId))
      .limit(1);
    if (realHyrox) {
      await tx
        .delete(hyroxProfiles)
        .where(eq(hyroxProfiles.userId, shadowUserId));
    } else {
      await tx
        .update(hyroxProfiles)
        .set({ userId: realUserId })
        .where(eq(hyroxProfiles.userId, shadowUserId));
    }

    // hyrox_session_logs is UNIQUE on (planSessionId, userId). For each
    // overlap, prefer the real user's row.
    const shadowLogs = await tx
      .select({
        id: hyroxSessionLogs.id,
        planSessionId: hyroxSessionLogs.planSessionId,
      })
      .from(hyroxSessionLogs)
      .where(eq(hyroxSessionLogs.userId, shadowUserId));
    for (const log of shadowLogs) {
      const [realLog] = await tx
        .select({ id: hyroxSessionLogs.id })
        .from(hyroxSessionLogs)
        .where(
          and(
            eq(hyroxSessionLogs.userId, realUserId),
            eq(hyroxSessionLogs.planSessionId, log.planSessionId)
          )
        )
        .limit(1);
      if (realLog) {
        await tx.delete(hyroxSessionLogs).where(eq(hyroxSessionLogs.id, log.id));
      } else {
        await tx
          .update(hyroxSessionLogs)
          .set({ userId: realUserId })
          .where(eq(hyroxSessionLogs.id, log.id));
      }
    }

    // track_day_scores: UNIQUE (trackDayId, userId). Same pattern.
    const shadowTrack = await tx
      .select({ id: trackDayScores.id, trackDayId: trackDayScores.trackDayId })
      .from(trackDayScores)
      .where(eq(trackDayScores.userId, shadowUserId));
    for (const row of shadowTrack) {
      const [realRow] = await tx
        .select({ id: trackDayScores.id })
        .from(trackDayScores)
        .where(
          and(
            eq(trackDayScores.userId, realUserId),
            eq(trackDayScores.trackDayId, row.trackDayId)
          )
        )
        .limit(1);
      if (realRow) {
        await tx.delete(trackDayScores).where(eq(trackDayScores.id, row.id));
      } else {
        await tx
          .update(trackDayScores)
          .set({ userId: realUserId })
          .where(eq(trackDayScores.id, row.id));
      }
    }

    // document_signatures: signer reassign. The unique constraint is on
    // (version, coalesce(subject, user)) so a guardian-signed-for-shadow
    // row keyed by subject_user_id still needs reassigning too.
    await tx
      .update(documentSignatures)
      .set({ userId: realUserId })
      .where(eq(documentSignatures.userId, shadowUserId));
    await tx
      .update(documentSignatures)
      .set({ subjectUserId: realUserId })
      .where(eq(documentSignatures.subjectUserId, shadowUserId));

    // family_members: every row that pointed the shadow as the
    // dependent now points to the real user. (account_holder_user_id
    // shadows shouldn't exist by construction.)
    await tx
      .update(familyMembers)
      .set({ dependentUserId: realUserId, updatedAt: new Date() })
      .where(eq(familyMembers.dependentUserId, shadowUserId));

    // community_memberships: UNIQUE (communityId, userId). For each
    // shadow membership, prefer the real user's row when it already
    // exists in the same gym.
    const shadowMemberships = await tx
      .select({
        id: communityMemberships.id,
        communityId: communityMemberships.communityId,
        accountId: communityMemberships.accountId,
        isActive: communityMemberships.isActive,
      })
      .from(communityMemberships)
      .where(eq(communityMemberships.userId, shadowUserId));
    for (const m of shadowMemberships) {
      const [realMembership] = await tx
        .select({
          id: communityMemberships.id,
          accountId: communityMemberships.accountId,
        })
        .from(communityMemberships)
        .where(
          and(
            eq(communityMemberships.userId, realUserId),
            eq(communityMemberships.communityId, m.communityId)
          )
        )
        .limit(1);
      if (realMembership) {
        // Real user is already in the gym independently. Preserve the
        // family-membership pointer by adopting the shadow's accountId
        // (so the dependent stays linked under the account holder) and
        // promote the membership to active. Then drop the shadow's row.
        await tx
          .update(communityMemberships)
          .set({
            accountId: m.accountId,
            isActive: m.isActive || undefined,
          })
          .where(eq(communityMemberships.id, realMembership.id));
        await tx
          .delete(communityMemberships)
          .where(eq(communityMemberships.id, m.id));
      } else {
        await tx
          .update(communityMemberships)
          .set({ userId: realUserId })
          .where(eq(communityMemberships.id, m.id));
      }
    }

    // Activeness: an activated real user should not be shadow itself.
    await tx
      .update(users)
      .set({ isShadow: false, updatedAt: new Date() })
      .where(eq(users.id, realUserId));

    // Finally, soft-delete the shadow row.
    await softDeleteShadowDependent(shadowUserId, tx);
  };

  if (txOrDb === db) {
    await db.transaction(run);
  } else {
    await run(txOrDb);
  }
}

// ---------------------------------------------------------------------------
// Promote shadow → owns-its-own-login (no email collision)
// ---------------------------------------------------------------------------

/**
 * Flip a shadow user to a real user (no merge needed). Called after
 * the activation password-set form succeeds and a Supabase auth user
 * has been created. Sets is_shadow=false on the user row, has_own_login
 * + activated_at on every family_members row pointing at them.
 */
export async function promoteShadowToReal(
  shadowUserId: string,
  newEmail?: string
): Promise<void> {
  await db.transaction(async (tx) => {
    const updates: Record<string, unknown> = {
      isShadow: false,
      updatedAt: new Date(),
    };
    if (newEmail) updates.email = newEmail.trim().toLowerCase();
    await tx.update(users).set(updates).where(eq(users.id, shadowUserId));

    await tx
      .update(familyMembers)
      .set({
        hasOwnLogin: true,
        activatedAt: new Date(),
        activationToken: null,
        activationTokenSentAt: null,
        activationTokenExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(familyMembers.dependentUserId, shadowUserId));
  });
}

// ---------------------------------------------------------------------------
// Existing-user-as-dependent invite (spec §3.3 step 4 + §4.6)
// ---------------------------------------------------------------------------

export interface CreateFamilyInviteInput {
  accountHolderUserId: string;
  communityId: string;
  inviteeUserId: string;
  relationship: FamilyRelationship;
}

export async function createFamilyInvite(
  input: CreateFamilyInviteInput
): Promise<{ token: string; expiresAt: Date }> {
  // Already linked? Bail.
  const [existingLink] = await db
    .select({ id: familyMembers.id })
    .from(familyMembers)
    .where(
      and(
        eq(familyMembers.communityId, input.communityId),
        eq(familyMembers.dependentUserId, input.inviteeUserId)
      )
    )
    .limit(1);
  if (existingLink) {
    throw new Error("ALREADY_LINKED");
  }

  // Pending invite? Reuse the token so a re-trigger from the UI doesn't
  // spam the recipient with multiple links.
  const [pending] = await db
    .select({
      id: familyInvites.id,
      token: familyInvites.token,
      expiresAt: familyInvites.expiresAt,
    })
    .from(familyInvites)
    .where(
      and(
        eq(familyInvites.communityId, input.communityId),
        eq(familyInvites.accountHolderUserId, input.accountHolderUserId),
        eq(familyInvites.inviteeUserId, input.inviteeUserId)
      )
    )
    .orderBy(sql`created_at desc`)
    .limit(1);
  if (pending && !pending.expiresAt) {
    // Defensive — should never happen; column is NOT NULL.
  }
  if (
    pending &&
    pending.expiresAt &&
    pending.expiresAt.getTime() > Date.now()
  ) {
    return { token: pending.token, expiresAt: pending.expiresAt };
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + FAMILY_INVITE_TTL_MS);
  await db.insert(familyInvites).values({
    communityId: input.communityId,
    accountHolderUserId: input.accountHolderUserId,
    inviteeUserId: input.inviteeUserId,
    relationship: input.relationship,
    token,
    expiresAt,
  });
  return { token, expiresAt };
}

/**
 * Accept a pending family invite; materializes the family_members row.
 *
 * `callerUserId` is the signed-in user. We re-validate the token →
 * invitee match inside the transaction so a leaked token (e.g. forwarded
 * to the wrong inbox) can't be accepted by anyone other than the
 * intended invitee, even if a future caller skips the route-level guard.
 */
export async function acceptFamilyInvite(
  token: string,
  callerUserId: string
): Promise<{
  communityId: string;
  accountHolderUserId: string;
  inviteeUserId: string;
  familyMemberId: string;
}> {
  return await db.transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(familyInvites)
      .where(eq(familyInvites.token, token))
      .limit(1);
    if (!invite) throw new Error("INVITE_NOT_FOUND");
    if (invite.inviteeUserId !== callerUserId) {
      throw new Error("INVITE_WRONG_RECIPIENT");
    }
    if (invite.respondedAt) throw new Error("INVITE_ALREADY_RESPONDED");
    if (invite.expiresAt.getTime() < Date.now()) throw new Error("INVITE_EXPIRED");

    // Ensure the invitee has a membership row in this gym.
    const [existingMembership] = await tx
      .select({
        id: communityMemberships.id,
        isActive: communityMemberships.isActive,
      })
      .from(communityMemberships)
      .where(
        and(
          eq(communityMemberships.communityId, invite.communityId),
          eq(communityMemberships.userId, invite.inviteeUserId)
        )
      )
      .limit(1);
    if (existingMembership) {
      await tx
        .update(communityMemberships)
        .set({
          accountId: invite.accountHolderUserId,
          isActive: true,
          deactivatedAt: null,
        })
        .where(eq(communityMemberships.id, existingMembership.id));
    } else {
      await tx.insert(communityMemberships).values({
        communityId: invite.communityId,
        userId: invite.inviteeUserId,
        accountId: invite.accountHolderUserId,
        isAdmin: false,
        isCoach: false,
        isActive: true,
      });
    }

    const [fm] = await tx
      .insert(familyMembers)
      .values({
        communityId: invite.communityId,
        accountHolderUserId: invite.accountHolderUserId,
        dependentUserId: invite.inviteeUserId,
        relationship: invite.relationship as FamilyRelationship,
        hasOwnLogin: true,
        activatedAt: new Date(),
      })
      .returning({ id: familyMembers.id });

    await tx
      .update(familyInvites)
      .set({ response: "accepted", respondedAt: new Date() })
      .where(eq(familyInvites.id, invite.id));

    await assertAccountConsistency(
      invite.communityId,
      invite.inviteeUserId,
      tx
    );

    return {
      communityId: invite.communityId,
      accountHolderUserId: invite.accountHolderUserId,
      inviteeUserId: invite.inviteeUserId,
      familyMemberId: fm.id,
    };
  });
}

export async function declineFamilyInvite(token: string): Promise<void> {
  await db
    .update(familyInvites)
    .set({ response: "declined", respondedAt: new Date() })
    .where(eq(familyInvites.token, token));
}

// ---------------------------------------------------------------------------
// Removal (spec §4.4)
// ---------------------------------------------------------------------------

/**
 * End the gym relationship for a dependent. Always deactivates the
 * dependent's community_memberships row and drops the family_members
 * link. For shadow dependents, frees the email by rewriting it to the
 * synthetic merged form. Scores stay attached for history (spec §4.4).
 */
export async function removeDependent(opts: {
  familyMemberId: string;
  accountHolderUserId: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [fm] = await tx
      .select()
      .from(familyMembers)
      .where(eq(familyMembers.id, opts.familyMemberId))
      .limit(1);
    if (!fm) throw new Error("NOT_FOUND");
    if (fm.accountHolderUserId !== opts.accountHolderUserId) {
      throw new Error("FORBIDDEN");
    }

    const [dep] = await tx
      .select({ id: users.id, isShadow: users.isShadow })
      .from(users)
      .where(eq(users.id, fm.dependentUserId))
      .limit(1);
    if (!dep) throw new Error("DEPENDENT_NOT_FOUND");

    await tx
      .delete(familyMembers)
      .where(eq(familyMembers.id, fm.id));

    // Deactivate the dependent's membership in this gym. The dependent's
    // global account, login (if any), and cross-gym history are
    // untouched.
    await tx
      .update(communityMemberships)
      .set({
        isActive: false,
        deactivatedAt: new Date(),
        // Reset accountId to the dependent so the invariant holds even
        // though they're inactive — a future re-join will create a fresh
        // membership but historic queries that look at this row see
        // self-pay (no stale account_holder pointer).
        accountId: fm.dependentUserId,
      })
      .where(
        and(
          eq(communityMemberships.communityId, fm.communityId),
          eq(communityMemberships.userId, fm.dependentUserId)
        )
      );

    // For shadows, free the originally-attempted email and rename so the
    // account holder doesn't see a dangling profile under the old name.
    if (dep.isShadow) {
      await softDeleteShadowDependent(dep.id, tx);
    }
  });
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

export interface FamilyMemberView {
  familyMemberId: string;
  communityId: string;
  relationship: FamilyRelationship;
  hasOwnLogin: boolean;
  notes: string | null;
  createdAt: Date;
  dependent: {
    id: string;
    name: string;
    email: string;
    isShadow: boolean;
    dateOfBirth: string | null;
    gender: string | null;
  };
  age: number | null;
  isMinor: boolean;
  isShadowEmail: boolean;
}

/**
 * List the dependents of `accountHolderUserId` in `communityId`. Annotates
 * each row with age + isMinor (computed against the gym's tz) and a flag
 * marking synthetic shadow emails so the UI can hide them.
 */
export async function listFamilyForAccountHolder(
  accountHolderUserId: string,
  communityId: string
): Promise<FamilyMemberView[]> {
  const [gym] = await db
    .select({ timezone: communities.gymTimezone })
    .from(communities)
    .where(eq(communities.id, communityId))
    .limit(1);
  const tz = resolveGymTimezone(gym?.timezone);

  const rows = await db
    .select({
      familyMemberId: familyMembers.id,
      communityId: familyMembers.communityId,
      relationship: familyMembers.relationship,
      hasOwnLogin: familyMembers.hasOwnLogin,
      notes: familyMembers.notes,
      createdAt: familyMembers.createdAt,
      dependentId: users.id,
      dependentName: users.name,
      dependentEmail: users.email,
      dependentIsShadow: users.isShadow,
      dependentDob: users.dateOfBirth,
      dependentGender: users.gender,
    })
    .from(familyMembers)
    .innerJoin(users, eq(users.id, familyMembers.dependentUserId))
    .where(
      and(
        eq(familyMembers.accountHolderUserId, accountHolderUserId),
        eq(familyMembers.communityId, communityId)
      )
    )
    .orderBy(familyMembers.createdAt);

  return rows.map((r) => ({
    familyMemberId: r.familyMemberId,
    communityId: r.communityId,
    relationship: r.relationship as FamilyRelationship,
    hasOwnLogin: r.hasOwnLogin,
    notes: r.notes,
    createdAt: r.createdAt,
    dependent: {
      id: r.dependentId,
      name: r.dependentName,
      email: r.dependentEmail,
      isShadow: r.dependentIsShadow,
      dateOfBirth: r.dependentDob,
      gender: r.dependentGender,
    },
    age: ageInGymTz(r.dependentDob, tz),
    isMinor: isMinor(r.dependentDob, tz),
    isShadowEmail: isShadowEmail(r.dependentEmail),
  }));
}

/** Same view but for a whole gym, grouped by account holder. Used by
 *  /gym/<id>/family (spec §4.7). */
export async function listFamiliesByGym(
  communityId: string
): Promise<
  Array<{
    accountHolder: { id: string; name: string; email: string };
    dependents: FamilyMemberView[];
  }>
> {
  const [gym] = await db
    .select({ timezone: communities.gymTimezone })
    .from(communities)
    .where(eq(communities.id, communityId))
    .limit(1);
  const tz = resolveGymTimezone(gym?.timezone);

  const dependentUsers = users;
  // Alias the second join to the account holder.
  const rows = await db
    .select({
      familyMemberId: familyMembers.id,
      relationship: familyMembers.relationship,
      hasOwnLogin: familyMembers.hasOwnLogin,
      notes: familyMembers.notes,
      createdAt: familyMembers.createdAt,
      accountHolderId: familyMembers.accountHolderUserId,
      depId: dependentUsers.id,
      depName: dependentUsers.name,
      depEmail: dependentUsers.email,
      depIsShadow: dependentUsers.isShadow,
      depDob: dependentUsers.dateOfBirth,
      depGender: dependentUsers.gender,
    })
    .from(familyMembers)
    .innerJoin(
      dependentUsers,
      eq(dependentUsers.id, familyMembers.dependentUserId)
    )
    .where(eq(familyMembers.communityId, communityId))
    .orderBy(familyMembers.accountHolderUserId, familyMembers.createdAt);

  if (rows.length === 0) return [];

  // Second pass to fetch account-holder display fields in bulk.
  const holderIds = [...new Set(rows.map((r) => r.accountHolderId))];
  const holders = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.id, holderIds));
  const holderById = new Map(holders.map((h) => [h.id, h]));

  const grouped = new Map<
    string,
    {
      accountHolder: { id: string; name: string; email: string };
      dependents: FamilyMemberView[];
    }
  >();
  for (const r of rows) {
    const holder = holderById.get(r.accountHolderId);
    if (!holder) continue; // shouldn't happen given FK
    let entry = grouped.get(r.accountHolderId);
    if (!entry) {
      entry = { accountHolder: holder, dependents: [] };
      grouped.set(r.accountHolderId, entry);
    }
    entry.dependents.push({
      familyMemberId: r.familyMemberId,
      communityId,
      relationship: r.relationship as FamilyRelationship,
      hasOwnLogin: r.hasOwnLogin,
      notes: r.notes,
      createdAt: r.createdAt,
      dependent: {
        id: r.depId,
        name: r.depName,
        email: r.depEmail,
        isShadow: r.depIsShadow,
        dateOfBirth: r.depDob,
        gender: r.depGender,
      },
      age: ageInGymTz(r.depDob, tz),
      isMinor: isMinor(r.depDob, tz),
      isShadowEmail: isShadowEmail(r.depEmail),
    });
  }
  return [...grouped.values()];
}

/** True iff `accountHolderUserId` owns the family_members row `id`. */
export async function familyMemberBelongsToHolder(
  familyMemberId: string,
  accountHolderUserId: string
): Promise<{
  ok: boolean;
  row?: {
    communityId: string;
    dependentUserId: string;
    hasOwnLogin: boolean;
  };
}> {
  const [r] = await db
    .select({
      accountHolderUserId: familyMembers.accountHolderUserId,
      communityId: familyMembers.communityId,
      dependentUserId: familyMembers.dependentUserId,
      hasOwnLogin: familyMembers.hasOwnLogin,
    })
    .from(familyMembers)
    .where(eq(familyMembers.id, familyMemberId))
    .limit(1);
  if (!r) return { ok: false };
  return {
    ok: r.accountHolderUserId === accountHolderUserId,
    row: {
      communityId: r.communityId,
      dependentUserId: r.dependentUserId,
      hasOwnLogin: r.hasOwnLogin,
    },
  };
}

/** List dependents (with own-login flag) the user can "Log for" in a gym. */
export async function listLogForCandidates(
  accountHolderUserId: string,
  communityId: string
): Promise<Array<{ userId: string; name: string }>> {
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
    })
    .from(familyMembers)
    .innerJoin(users, eq(users.id, familyMembers.dependentUserId))
    .where(
      and(
        eq(familyMembers.accountHolderUserId, accountHolderUserId),
        eq(familyMembers.communityId, communityId)
      )
    )
    .orderBy(users.name);
  return rows;
}
