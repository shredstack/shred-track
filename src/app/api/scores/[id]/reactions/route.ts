import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { scoreReactions, scores } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canInteractWithScore } from "@/lib/authz/social";
import { inngest } from "@/inngest/client";

// Only the 🔥 reaction is supported in v1; the column accepts more.
const ALLOWED_REACTIONS = new Set(["fire"]);

// POST /api/scores/:id/reactions
//
// Idempotent toggle-on. A second POST from the same user returns 200 with
// the existing reaction's id instead of failing on the unique constraint.
// Increments scores.reaction_count transactionally only when we actually
// inserted a new row.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: scoreId } = await params;
  const body = await req.json().catch(() => ({}));
  const reaction =
    typeof body.reaction === "string" ? body.reaction : "fire";
  if (!ALLOWED_REACTIONS.has(reaction)) {
    return NextResponse.json(
      { error: "Unsupported reaction" },
      { status: 400 }
    );
  }

  const { allowed, ctx } = await canInteractWithScore(user.id, scoreId);
  if (!ctx) {
    return NextResponse.json({ error: "Score not found" }, { status: 404 });
  }
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { reactionId, created } = await db.transaction(async (tx) => {
    // ON CONFLICT lets us return either the freshly inserted row or the
    // pre-existing one in a single round trip. The DO UPDATE is a no-op
    // touch — it's required because DO NOTHING returns no rows.
    //
    // `xmax = 0` on the returned row means an INSERT happened (no prior
    // version exists); a non-zero xmax means DO UPDATE fired on an existing
    // row. This is the canonical way to distinguish insert vs. update in
    // ON CONFLICT and avoids the race in any time-based heuristic.
    const [row] = await tx
      .insert(scoreReactions)
      .values({
        scoreId,
        userId: user.id,
        reaction,
      })
      .onConflictDoUpdate({
        target: [
          scoreReactions.scoreId,
          scoreReactions.userId,
          scoreReactions.reaction,
        ],
        set: { reaction: sql`excluded.reaction` },
      })
      .returning({
        id: scoreReactions.id,
        inserted: sql<boolean>`(xmax = 0)`,
      });

    const created = row.inserted === true;

    if (created) {
      await tx
        .update(scores)
        .set({ reactionCount: sql`${scores.reactionCount} + 1` })
        .where(eq(scores.id, scoreId));
    }

    return { reactionId: row.id, created };
  });

  if (created) {
    // Fire-and-forget. Failure to enqueue must not roll back the reaction.
    try {
      await inngest.send({
        name: "social/reaction.created",
        data: { reactionId, scoreId, actorId: user.id },
      });
    } catch (err) {
      console.error("[reactions] inngest send failed", err);
    }
  }

  return NextResponse.json(
    { reactionId, created },
    { status: created ? 201 : 200 }
  );
}

// DELETE /api/scores/:id/reactions?reaction=fire
//
// Removes the caller's reaction. Returns 204 whether or not a row existed
// (idempotent), but only decrements the count when something was actually
// removed.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: scoreId } = await params;
  // Reaction kind can come from the query string (DELETE typically doesn't
  // ship a body) or the body for parity with POST.
  const url = new URL(req.url);
  let reaction = url.searchParams.get("reaction") ?? "fire";
  if (req.headers.get("content-length")) {
    const body = await req.json().catch(() => ({}));
    if (typeof body.reaction === "string") reaction = body.reaction;
  }
  if (!ALLOWED_REACTIONS.has(reaction)) {
    return NextResponse.json(
      { error: "Unsupported reaction" },
      { status: 400 }
    );
  }

  const { allowed, ctx } = await canInteractWithScore(user.id, scoreId);
  if (!ctx) {
    return NextResponse.json({ error: "Score not found" }, { status: 404 });
  }
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(scoreReactions)
      .where(
        and(
          eq(scoreReactions.scoreId, scoreId),
          eq(scoreReactions.userId, user.id),
          eq(scoreReactions.reaction, reaction)
        )
      )
      .returning({ id: scoreReactions.id });
    if (deleted.length > 0) {
      await tx
        .update(scores)
        .set({
          // Guard against drift — never go below zero.
          reactionCount: sql`GREATEST(${scores.reactionCount} - 1, 0)`,
        })
        .where(eq(scores.id, scoreId));
    }
  });

  return new NextResponse(null, { status: 204 });
}
