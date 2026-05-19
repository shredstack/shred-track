// ---------------------------------------------------------------------------
// Notification copy module (spec §1.10 / brainstorm §5.8, expanded in PR 2 §2.6).
//
// Each notification kind has a small corpus of title/body variants.
// renderNotificationCopy picks one deterministically per notification id so
// the same notification stays stable on re-fetch but the corpus rotates.
// ---------------------------------------------------------------------------

export type NotifKind =
  | "score_reaction"
  | "score_comment"
  | "score_mention"
  | "workout_published"
  | "social_post_published"
  | "social_post_reaction"
  | "social_post_comment"
  | "social_post_mention"
  | "committed_club_progress"
  | "committed_club_earned"
  | "committed_club_streak"
  | "class_cancelled"
  | "class_reservation_reminder";

export interface CopyContext {
  actorName?: string;
  workoutTitle?: string;
  gymName?: string;
  excerpt?: string;
  // Committed Club + class context.
  classesAttended?: number;
  threshold?: number;
  rank?: number;
  streakMonths?: number;
  yearMonth?: string;
  classStartAt?: string; // ISO
  className?: string;
  // workout_published: Monday-anchored ISO date (YYYY-MM-DD) for the
  // release's week. Used to render "week of <Mon>" in the title/body.
  releaseWeekStart?: string;
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

  workout_published: [
    (ctx) => ({
      title: "🔔 Programming dropped",
      body: programmingDroppedBody(ctx),
    }),
    (ctx) => ({
      title: "📋 New programming up",
      body: programmingDroppedBody(ctx),
    }),
  ],

  social_post_published: [
    (ctx) => ({
      title: "📣 New post in your gym",
      body: ctx.actorName
        ? `${ctx.actorName} just posted.`
        : "Open the feed to read it.",
    }),
    (ctx) => ({
      title: "📰 Gym update",
      body: ctx.excerpt ? truncate(ctx.excerpt, 90) : "Something new in the feed.",
    }),
    (ctx) => ({
      title: "📌 From the whiteboard",
      body: ctx.actorName
        ? `${ctx.actorName} shared a post.`
        : "Check the gym feed for the latest.",
    }),
  ],

  social_post_reaction: [
    (ctx) => ({
      title: "🔥 Someone reacted to your post",
      body: ctx.actorName
        ? `${ctx.actorName} hit fire on your post.`
        : "Your post is getting reactions.",
    }),
    (ctx) => ({
      title: "👏 Reaction landed",
      body: ctx.actorName
        ? `${ctx.actorName} cheered your post.`
        : "Open the feed to see who reacted.",
    }),
    () => ({
      title: "🎉 Your post is on fire",
      body: "Tap to see who reacted.",
    }),
  ],

  social_post_comment: [
    (ctx) => ({
      title: "💬 Comment on your post",
      body: ctx.actorName
        ? `${ctx.actorName}: ${truncate(ctx.excerpt ?? "", 80)}`
        : truncate(ctx.excerpt ?? "Someone replied to your post.", 90),
    }),
    (ctx) => ({
      title: "📝 New reply",
      body: ctx.actorName
        ? `${ctx.actorName} commented on your post.`
        : "Open to read the thread.",
    }),
  ],

  social_post_mention: [
    (ctx) => ({
      title: "@you in the feed",
      body: ctx.actorName
        ? `${ctx.actorName} mentioned you in a post.`
        : "Someone tagged you in the feed.",
    }),
    (ctx) => ({
      title: "👀 You were tagged in a post",
      body: ctx.actorName ? `${ctx.actorName} mentioned you.` : "Tap to read.",
    }),
  ],

  committed_club_progress: [
    (ctx) => ({
      title: "🔥 On pace for Committed Club",
      body:
        ctx.classesAttended != null && ctx.threshold != null
          ? `${ctx.classesAttended}/${ctx.threshold} classes this month. Keep going.`
          : "You're closing in on Committed Club.",
    }),
    (ctx) => ({
      title: "💪 Halfway there",
      body:
        ctx.classesAttended != null && ctx.threshold != null
          ? `${ctx.threshold - ctx.classesAttended} classes to Committed Club.`
          : "A few more classes to lock it in.",
    }),
    (ctx) => ({
      title: "🎯 One more to go",
      body:
        ctx.classesAttended != null && ctx.threshold != null
          ? `Class #${ctx.threshold} earns Committed Club.`
          : "One more class earns Committed Club.",
    }),
  ],

  committed_club_earned: [
    (ctx) => ({
      title: "🏆 You're in",
      body: ctx.gymName
        ? `Welcome to ${ctx.gymName}'s Committed Club for the month.`
        : "Welcome to Committed Club for the month.",
    }),
    (ctx) => ({
      title: "👑 First into the club",
      body:
        ctx.rank === 1
          ? "You're rank #1 in Committed Club this month."
          : "Committed Club: locked in.",
    }),
    () => ({
      title: "🔥 Committed Club earned",
      body: "15 classes done. You showed up.",
    }),
  ],

  committed_club_streak: [
    (ctx) => ({
      title: "🔥 Streak alive",
      body: ctx.streakMonths
        ? `${ctx.streakMonths} months in Committed Club.`
        : "You extended your Committed Club streak.",
    }),
    (ctx) => ({
      title: "📅 Another month",
      body: ctx.streakMonths
        ? `Committed Club streak: ${ctx.streakMonths} months.`
        : "Committed Club streak extended.",
    }),
  ],

  class_cancelled: [
    (ctx) => ({
      title: "⚠️ Class cancelled",
      body: ctx.className
        ? `${ctx.className} was cancelled.`
        : "A class you registered for was cancelled.",
    }),
    (ctx) => ({
      title: "❌ Heads up",
      body: ctx.className
        ? `${ctx.className} won't happen as scheduled.`
        : "One of your registered classes was cancelled.",
    }),
  ],

  class_reservation_reminder: [
    (ctx) => ({
      title: "⏰ Class soon",
      body: ctx.className
        ? `${ctx.className} starts in about an hour.`
        : "You're on the list — class starts soon.",
    }),
    () => ({
      title: "📍 Heads up",
      body: "Your class is about an hour out.",
    }),
  ],
};

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}

function programmingDroppedBody(ctx: CopyContext): string {
  const weekPart = ctx.releaseWeekStart
    ? `week of ${formatWeekOf(ctx.releaseWeekStart)}`
    : null;
  if (ctx.gymName && weekPart) return `${ctx.gymName} — ${weekPart}.`;
  if (weekPart) return `New programming for the ${weekPart}.`;
  if (ctx.gymName) return `${ctx.gymName} posted new programming.`;
  return "Tap to see what's on deck.";
}

// Renders a Monday ISO date (YYYY-MM-DD) as "Mon, May 18". The release's
// weekStart is stored as a plain date (no timezone) — parse component-wise
// to avoid the UTC-shift gotcha that drops dates by one day in negative
// offsets.
function formatWeekOf(weekStartIso: string): string {
  const [y, m, d] = weekStartIso.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return weekStartIso;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function stableIndex(id: string, modulo: number): number {
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
