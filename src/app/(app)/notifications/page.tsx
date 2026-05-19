"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  AtSign,
  Bell,
  CalendarX,
  CheckCheck,
  Clock,
  Dumbbell,
  Flame,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  Megaphone,
  Trophy,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "@/hooks/useNotifications";
import { useGymContext, useSetActiveCommunity } from "@/hooks/useGymContext";
import { renderNotificationCopy } from "@/lib/notifications/copy";
import type { NotificationDisplay, NotificationKind } from "@/types/social";

function relativeTime(iso: string): string {
  const diffSec = Math.max(
    1,
    Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  );
  if (diffSec < 60) return `${diffSec}s`;
  const m = Math.round(diffSec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function KindIcon({ kind }: { kind: NotificationKind }) {
  switch (kind) {
    case "score_reaction":
    case "social_post_reaction":
      return <Flame className="size-4 text-orange-400" />;
    case "score_comment":
    case "social_post_comment":
      return <MessageCircle className="size-4 text-blue-400" />;
    case "score_mention":
    case "social_post_mention":
      return <AtSign className="size-4 text-purple-400" />;
    case "workout_published":
      return <Dumbbell className="size-4 text-emerald-400" />;
    case "social_post_published":
      return <Megaphone className="size-4 text-sky-400" />;
    case "committed_club_progress":
    case "committed_club_earned":
    case "committed_club_streak":
      return <Trophy className="size-4 text-amber-400" />;
    case "class_cancelled":
      return <CalendarX className="size-4 text-rose-400" />;
    case "class_reservation_reminder":
      return <Clock className="size-4 text-cyan-400" />;
    default:
      return <Bell className="size-4 text-muted-foreground" />;
  }
}

function NotificationText({ item }: { item: NotificationDisplay }) {
  // Share the same copy module the push dispatcher uses so push and inbox
  // text never drift apart. The notification id seeds variant selection so
  // a row's text stays stable across re-fetches.
  const excerpt =
    item.bodyPreview && item.bodyPreview.trim().length > 0
      ? item.bodyPreview
      : item.hasAttachment
        ? "sent a GIF"
        : undefined;
  const copy = renderNotificationCopy(item.kind, item.id, {
    actorName: item.actorName ?? undefined,
    workoutTitle: item.workoutTitle || undefined,
    gymName: item.gymName ?? undefined,
    className: item.className ?? undefined,
    classStartAt: item.classStartAt ?? undefined,
    releaseWeekStart: item.releaseWeekStart ?? undefined,
    excerpt,
  });
  return (
    <span>
      <span className="font-medium">{copy.title}</span>
      <span className="text-muted-foreground"> — {copy.body}</span>
    </span>
  );
}

function NotificationRow({
  item,
  onClick,
}: {
  item: NotificationDisplay;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 border-b border-border/30 px-3 py-3 text-left transition-colors hover:bg-muted/40 ${
        item.readAt ? "" : "bg-primary/[0.04]"
      }`}
    >
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
        {item.actorImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.actorImage}
            alt={item.actorName ?? "User"}
            className="size-full object-cover"
          />
        ) : (
          <User className="size-4 text-muted-foreground" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <div className="mt-0.5 shrink-0">
          <KindIcon kind={item.kind} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug">
            <NotificationText item={item} />
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {relativeTime(item.createdAt)}
          </p>
        </div>
        {item.hasAttachment && !item.bodyPreview && (
          <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
      </div>
      {!item.readAt && (
        <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" />
      )}
    </button>
  );
}

export default function NotificationsPage() {
  const router = useRouter();
  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const { data: gymCtx } = useGymContext();
  const setActiveCommunity = useSetActiveCommunity();

  const items = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data]
  );

  // Gym-scoped pages (social feed, classes, committed-club) read from
  // activeCommunityId. If the user is currently active on a different gym
  // than the notification's, switch first so the destination renders the
  // right community.
  async function ensureActiveCommunity(communityId: string | null) {
    if (!communityId) return;
    if (gymCtx?.activeCommunityId === communityId) return;
    const isMember = gymCtx?.memberships.some(
      (m) => m.communityId === communityId && m.isActive
    );
    if (!isMember) return;
    try {
      await setActiveCommunity.mutateAsync(communityId);
    } catch {
      // If the switch fails (server rejected, network), fall through and
      // still attempt navigation — the destination may still load by id.
    }
  }

  async function handleOpen(item: NotificationDisplay) {
    if (!item.readAt) markRead.mutate(item.id);
    // Routing fallback chain mirrors the push dispatcher's targetUrl
    // (src/inngest/functions/dispatch-notification.ts) so an in-app tap
    // and a push tap go to the same place.
    if (item.gymPostId) {
      await ensureActiveCommunity(item.communityId);
      router.push(`/gym/social/${item.gymPostId}`);
      return;
    }
    if (item.classInstanceId) {
      // Member-facing class notifications (cancelled, reminder) land on the
      // top-level /classes list. There's no member-facing class detail
      // route yet; the admin /gym/classes/[id] view wouldn't be right here
      // since recipients receive these as registered members.
      await ensureActiveCommunity(item.communityId);
      router.push(`/classes`);
      return;
    }
    if (item.communityId && item.kind.startsWith("committed_club")) {
      await ensureActiveCommunity(item.communityId);
      router.push(`/gym/committed-club`);
      return;
    }
    if (item.kind === "workout_published") {
      // Programming-drop notifications drop the athlete on today's CrossFit
      // tab — no specific workout date, no leaderboard. They can navigate
      // the week or open a leaderboard themselves from there.
      await ensureActiveCommunity(item.communityId);
      router.push("/crossfit");
      return;
    }
    if (item.workoutId) {
      const params = new URLSearchParams();
      if (item.workoutDate) params.set("date", item.workoutDate);
      params.set("leaderboard", item.workoutId);
      if (item.scoreId && item.kind !== "score_reaction") {
        // Reactions don't open the comments drawer — only comment / mention
        // notifications take the user to the comment thread.
        params.set("scoreComment", item.scoreId);
      }
      router.push(`/crossfit?${params.toString()}`);
    }
    // No deep-link target: tap only marks read (no navigation) instead of
    // dumping the user onto a random tab.
  }

  return (
    <div className="mx-auto max-w-lg px-3 py-4">
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="size-4 text-muted-foreground" />
          <h1 className="text-base font-semibold">Notifications</h1>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => markAllRead.mutate()}
          disabled={markAllRead.isPending || items.every((i) => i.readAt)}
        >
          <CheckCheck className="mr-1 size-3.5" />
          Mark all read
        </Button>
      </header>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <p className="py-6 text-center text-sm text-destructive">
          {(error as Error).message}
        </p>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/40 p-10 text-center text-sm text-muted-foreground">
          You&apos;re all caught up.
        </div>
      ) : (
        <>
          {items.map((item) => (
            <NotificationRow
              key={item.id}
              item={item}
              onClick={() => handleOpen(item)}
            />
          ))}
          {hasNextPage && (
            <div className="flex justify-center py-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? (
                  <Loader2 className="mr-1 size-3.5 animate-spin" />
                ) : null}
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
