"use client";

import {
  Sparkles,
  Loader2,
  AlertCircle,
  Trophy,
  Wrench,
  CalendarClock,
  Flame,
  Leaf,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useNotesInsights } from "@/hooks/useCrossfitInsights";
import { useIsNative } from "@/hooks/useIsNative";
import { useUserProfile } from "@/hooks/useProfile";
import type {
  NotesAggregateComplaint,
  NotesAggregateMilestone,
  NotesAggregateScalingReason,
  NotesDormantWin,
  NotesInsights,
  NotesRpeCallout,
  NotesTemporalCallout,
} from "@/lib/crossfit/insights/notes-extraction";

export function NotesInsightsCard() {
  const { data: user, isLoading: userLoading } = useUserProfile();
  const isVip = !!user?.isVip;
  const isNative = useIsNative();

  const {
    data,
    isLoading: insightsLoading,
    isError,
  } = useNotesInsights({ enabled: isVip });

  const isLoading = userLoading || (isVip && insightsLoading);

  // On native, the only thing non-VIPs would see is the upsell teaser. Hide
  // the whole card for them — no surfacing of paid-feature copy on iOS.
  if (isNative && !isVip) return null;

  return (
    <Card className="gradient-border">
      <CardContent className="p-4 md:p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-fuchsia-500/10">
            <Sparkles className="h-5 w-5 text-fuchsia-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold">From your notes</p>
              <Badge
                variant="outline"
                className="text-[10px] text-fuchsia-300 border-fuchsia-500/40 bg-fuchsia-500/10"
              >
                VIP
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Patterns we&apos;ve spotted in what you&apos;ve been writing.
            </p>
          </div>
        </div>

        {!isVip && !userLoading && <NonVipState />}

        {isVip && isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {isVip && isError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Couldn&apos;t load notes insights. Try again later.
          </div>
        )}

        {isVip && data && <Body data={data} />}
      </CardContent>
    </Card>
  );
}

function NonVipState() {
  return (
    <div className="rounded-md border border-dashed border-fuchsia-500/30 bg-fuchsia-500/5 py-5 px-3 text-center">
      <p className="text-sm font-medium">A future ShredTrack subscription</p>
      <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
        We&apos;ll surface recurring complaints, scaling patterns, and
        milestones extracted from the notes you write on each score. Coming
        as a paid add-on.
      </p>
    </div>
  );
}

function Body({ data }: { data: NotesInsights }) {
  if (data.scoresExtracted === 0) {
    return (
      <div className="rounded-md border border-dashed border-white/[0.06] py-5 px-3 text-center">
        <p className="text-sm font-medium">Nothing to show yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          We process your notes once a day. Once you&apos;ve written notes on
          a few workouts, patterns will show up here.
        </p>
      </div>
    );
  }

  const temporalCallouts = data.temporalCallouts ?? [];
  const rpeCallouts = data.rpeCallouts ?? [];
  const dormantWins = data.dormantWins ?? [];

  const hasContent =
    data.complaints.length +
      data.scalingRationale.length +
      data.milestones.length +
      temporalCallouts.length +
      rpeCallouts.length +
      dormantWins.length >
    0;

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        {data.scoresExtracted} note
        {data.scoresExtracted === 1 ? "" : "s"} analyzed
        {data.lastExtractedAt &&
          ` · last run ${formatRelative(data.lastExtractedAt)}`}
      </p>

      {!hasContent ? (
        <div className="rounded-md border border-dashed border-white/[0.06] py-5 px-3 text-center">
          <p className="text-xs text-muted-foreground">
            No recurring patterns yet — we surface a topic only when it shows
            up in two or more notes.
          </p>
        </div>
      ) : (
        <>
          {data.complaints.length > 0 && (
            <Section
              title="Recurring complaints"
              icon={
                <AlertCircle className="h-3.5 w-3.5 text-orange-400" />
              }
            >
              {data.complaints.map((c) => (
                <ComplaintRow key={c.topic} item={c} />
              ))}
            </Section>
          )}

          {temporalCallouts.length > 0 && (
            <Section
              title="Patterns we noticed"
              icon={
                <CalendarClock className="h-3.5 w-3.5 text-sky-400" />
              }
            >
              {temporalCallouts.map((c, i) => (
                <TemporalCalloutRow key={i} item={c} />
              ))}
            </Section>
          )}

          {rpeCallouts.length > 0 && (
            <Section
              title="When effort spikes"
              icon={<Flame className="h-3.5 w-3.5 text-rose-400" />}
            >
              {rpeCallouts.map((c, i) => (
                <RpeCalloutRow key={i} item={c} />
              ))}
            </Section>
          )}

          {data.scalingRationale.length > 0 && (
            <Section
              title="When you scale"
              icon={<Wrench className="h-3.5 w-3.5 text-amber-400" />}
            >
              {data.scalingRationale.map((r, i) => (
                <ScalingReasonRow key={i} item={r} />
              ))}
            </Section>
          )}

          {(data.milestones.length > 0 || dormantWins.length > 0) && (
            <Section
              title="Wins"
              icon={<Trophy className="h-3.5 w-3.5 text-emerald-400" />}
            >
              {dormantWins.map((w) => (
                <DormantWinRow key={w.topic} item={w} />
              ))}
              {data.milestones.map((m) => (
                <MilestoneRow key={m.scoreId + m.phrase} item={m} />
              ))}
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <p className="text-xs font-medium">{title}</p>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function ComplaintRow({ item }: { item: NotesAggregateComplaint }) {
  return (
    <div className="text-xs">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium capitalize">{item.topic}</span>
        <span className="text-[10px] text-muted-foreground">
          {item.mentions} mention{item.mentions === 1 ? "" : "s"} · last{" "}
          {shortDate(item.lastMentionedAt)}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground italic line-clamp-2">
        “{item.examplePhrase}”
      </p>
    </div>
  );
}

function ScalingReasonRow({ item }: { item: NotesAggregateScalingReason }) {
  const head = item.movement
    ? `${item.movement} → ${item.reason}`
    : item.reason;
  return (
    <div className="text-xs">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium capitalize">{head}</span>
        <span className="text-[10px] text-muted-foreground">
          {item.mentions} time{item.mentions === 1 ? "" : "s"}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground italic line-clamp-2">
        “{item.examplePhrase}”
      </p>
    </div>
  );
}

function MilestoneRow({ item }: { item: NotesAggregateMilestone }) {
  const tag =
    item.type === "first" ? "First" : item.type === "pr" ? "PR" : "Win";
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span>
        <Badge
          variant="outline"
          className="mr-1.5 text-[9px] text-emerald-300 border-emerald-500/40 bg-emerald-500/10 align-middle"
        >
          {tag}
        </Badge>
        <span className="text-foreground">“{item.phrase}”</span>
      </span>
      <span className="text-[10px] text-muted-foreground shrink-0">
        {shortDate(item.workoutDate)}
      </span>
    </div>
  );
}

function TemporalCalloutRow({ item }: { item: NotesTemporalCallout }) {
  // "after rest" or a day-of-week label.
  const bucketCopy =
    item.dimension === "post_rest" ? "after a rest day" : `on ${item.bucket}s`;
  // Lift × baseline. Surface as integer when close to a round number.
  const lift = item.baselineMentions > 0
    ? item.mentions / item.baselineMentions
    : 0;
  const liftLabel = lift >= 10 ? "10×+" : `${lift.toFixed(1)}×`;
  return (
    <div className="text-xs">
      <p className="text-foreground">
        You mention{" "}
        <span className="font-medium capitalize">&ldquo;{item.topic}&rdquo;</span>{" "}
        {bucketCopy}{" "}
        <span className="text-sky-300">{liftLabel} more than other days</span>.
      </p>
      <p className="text-[10px] text-muted-foreground">
        {item.mentions} mention{item.mentions === 1 ? "" : "s"} vs ~
        {item.baselineMentions} expected.
      </p>
    </div>
  );
}

function RpeCalloutRow({ item }: { item: NotesRpeCallout }) {
  const lift = item.overallRate > 0
    ? item.highRpeRate / item.overallRate
    : 0;
  const liftLabel = lift >= 10 ? "10×+" : `${lift.toFixed(1)}×`;
  return (
    <div className="text-xs">
      <p className="text-foreground">
        On RPE-9+ days you mention{" "}
        <span className="font-medium capitalize">&ldquo;{item.topic}&rdquo;</span>{" "}
        <span className="text-rose-300">{liftLabel} more often</span>.
      </p>
      <p className="text-[10px] text-muted-foreground">
        {item.highRpeMentions} of {item.highRpeScores} hard sessions.
      </p>
    </div>
  );
}

function DormantWinRow({ item }: { item: NotesDormantWin }) {
  const lastSeen = item.lastMentionedAt
    ? ` (last on ${shortDate(item.lastMentionedAt)})`
    : "";
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="min-w-0">
        <Badge
          variant="outline"
          className="mr-1.5 text-[9px] text-emerald-300 border-emerald-500/40 bg-emerald-500/10 align-middle"
        >
          <Leaf className="h-2.5 w-2.5 mr-0.5 inline" />
          Quiet
        </Badge>
        <span className="text-foreground">
          You haven&apos;t mentioned{" "}
          <span className="font-medium capitalize">
            &ldquo;{item.topic}&rdquo;
          </span>{" "}
          in 4+ weeks
          <span className="text-muted-foreground">{lastSeen}</span>.
        </span>
      </span>
    </div>
  );
}

function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatRelative(iso: string): string {
  const then = new Date(iso);
  const ms = Date.now() - then.getTime();
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
