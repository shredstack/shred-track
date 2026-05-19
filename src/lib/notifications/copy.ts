// ---------------------------------------------------------------------------
// Notification copy module (spec §1.10 / brainstorm §5.8).
//
// Each notification kind has a small corpus of title/body variants.
// renderNotificationCopy picks one deterministically per notification id so
// the same notification stays stable on re-fetch but the corpus rotates.
//
// New kinds are added in PR 2/3 — this module is the single place to grow.
// ---------------------------------------------------------------------------

export type NotifKind =
  | "score_reaction"
  | "score_comment"
  | "score_mention";

export interface CopyContext {
  actorName?: string;
  workoutTitle?: string;
  gymName?: string;
  excerpt?: string;
}

interface Variant {
  title: string;
  body: string;
}

type VariantFactory = (ctx: CopyContext) => Variant;

const VARIANTS: Record<NotifKind, VariantFactory[]> = {
  score_reaction: [
    (ctx) => ({
      title: "🔥 Someone hit fire on your score",
      body: ctx.actorName
        ? `${ctx.actorName} reacted to your ${ctx.workoutTitle ?? "workout"}.`
        : "A reaction landed on your latest score.",
    }),
    (ctx) => ({
      title: "👏 Nice work",
      body: ctx.actorName
        ? `${ctx.actorName} cheered for your ${ctx.workoutTitle ?? "score"}.`
        : "Your score got a cheer.",
    }),
    (ctx) => ({
      title: "🏋️ Earned a reaction",
      body: ctx.actorName
        ? `${ctx.actorName} reacted to your post.`
        : "Your score is getting love.",
    }),
  ],
  score_comment: [
    (ctx) => ({
      title: "💬 New comment",
      body: ctx.actorName
        ? `${ctx.actorName}: ${truncate(ctx.excerpt ?? "", 80)}`
        : truncate(ctx.excerpt ?? "Someone replied to your score.", 90),
    }),
    (ctx) => ({
      title: "📝 You got a comment",
      body: ctx.actorName
        ? `${ctx.actorName} said: ${truncate(ctx.excerpt ?? "", 80)}`
        : "Open the app to read it.",
    }),
  ],
  score_mention: [
    (ctx) => ({
      title: "@you",
      body: ctx.actorName
        ? `${ctx.actorName} mentioned you in a comment.`
        : "Someone tagged you in a comment.",
    }),
    (ctx) => ({
      title: "👀 You were tagged",
      body: ctx.actorName
        ? `${ctx.actorName} mentioned you.`
        : "Open to read the thread.",
    }),
  ],
};

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}

function stableIndex(id: string, modulo: number): number {
  // Cheap deterministic hash so the same notification id picks the same
  // variant across fetches. Don't need cryptographic strength.
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % modulo;
}

export function renderNotificationCopy(
  kind: NotifKind,
  notifId: string,
  ctx: CopyContext
): Variant {
  const variants = VARIANTS[kind];
  if (!variants || variants.length === 0) {
    return {
      title: "ShredTrack",
      body: "You have a new notification.",
    };
  }
  const idx = stableIndex(notifId, variants.length);
  return variants[idx](ctx);
}
