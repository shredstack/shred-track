"use client";

// Programming week header. Replaces the bare "week of <Monday>" + two
// chevron buttons that used to live in `ProgrammingWeekView` with a
// purpose-built navigator. It answers two questions at a glance:
//
//   A. *What week am I editing?* — full date range, a relative-position
//      badge ("This week" / "Next week" / "3 weeks ago"), and the
//      release status pill (Empty / Draft / Published) all sit on the
//      headline row.
//
//   B. *How do I get to any other week fast?* — month stepper, week
//      stepper, a date-picker input (Monday-snapped) on the date label,
//      a quick-jump dropdown (This/Next/Last week, 4 weeks ago, same
//      week last year), and explicit "next empty week" shortcuts for
//      coaches backfilling history.
//
// The mini week strip below the controls shows the surrounding ±3
// weeks with status dots so the coach can see context without having
// to click.

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FastForward,
  MoreHorizontal,
  Rewind,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useHasMounted } from "@/hooks/useHasMounted";

type WeekStatus = "published" | "draft" | "empty";

interface SurroundingWeek {
  weekStart: string;
  status: WeekStatus;
}

interface NavData {
  weekStart: string;
  surrounding: SurroundingWeek[];
  nextEmptyBackward: string | null;
  nextEmptyForward: string | null;
  earliestProgrammedWeek: string | null;
  latestProgrammedWeek: string | null;
}

interface Props {
  communityId: string;
  gymTimezone: string;
  weekStart: string;
  // Status of the *current* week's release — passed in by the parent so
  // the pill in the header stays in sync with the week data the parent
  // already fetched (avoids a second request and avoids a flicker when
  // the release is created/deleted).
  currentStatus: WeekStatus;
}

// --- Date utilities ---------------------------------------------------------

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mondayOfDateInTz(date: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = fmt.formatToParts(date);
  const get = (k: string) => parts.find((p) => p.type === k)?.value ?? "";
  const y = get("year");
  const m = get("month");
  const d = get("day");
  const weekday = get("weekday");
  const idx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  const offset = (idx - 1 + 7) % 7;
  const dt = new Date(`${y}-${m}-${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() - offset);
  return dt.toISOString().slice(0, 10);
}

function mondayOfIso(iso: string): string {
  // Walk a YYYY-MM-DD back to the Monday of its week. No tz dependency
  // — the input is already a calendar date (e.g. from <input type=date>).
  const d = new Date(iso + "T00:00:00Z");
  const dow = d.getUTCDay(); // 0=Sun .. 6=Sat
  const offset = (dow - 1 + 7) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

function weeksBetween(a: string, b: string): number {
  const at = new Date(a + "T00:00:00Z").getTime();
  const bt = new Date(b + "T00:00:00Z").getTime();
  return Math.round((bt - at) / (7 * 86_400_000));
}

function formatWeekRange(weekStart: string): string {
  const start = new Date(weekStart + "T00:00:00Z");
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const sameMonth =
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCFullYear() === end.getUTCFullYear();
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  if (sameMonth) {
    return (
      start.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }) +
      " – " +
      end.toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" }) +
      ", " +
      start.getUTCFullYear()
    );
  }
  if (sameYear) {
    return (
      start.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }) +
      " – " +
      end.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }) +
      ", " +
      start.getUTCFullYear()
    );
  }
  return (
    start.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }) +
    " – " +
    end.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    })
  );
}

function relativeWeekLabel(diff: number): string {
  if (diff === 0) return "This week";
  if (diff === 1) return "Next week";
  if (diff === -1) return "Last week";
  if (diff > 0) {
    const yrs = Math.round(diff / 52);
    if (diff >= 52 && Math.abs(diff - yrs * 52) <= 1) {
      return yrs === 1 ? "In ~1 year" : `In ~${yrs} years`;
    }
    return `In ${diff} weeks`;
  }
  const abs = Math.abs(diff);
  const yrs = Math.round(abs / 52);
  if (abs >= 52 && Math.abs(abs - yrs * 52) <= 1) {
    return yrs === 1 ? "~1 year ago" : `~${yrs} years ago`;
  }
  return `${abs} weeks ago`;
}

function shortMonthDay(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// --- Subcomponents ----------------------------------------------------------

function StatusPill({ status }: { status: WeekStatus }) {
  const cls =
    status === "published"
      ? "bg-emerald-500/15 text-emerald-400"
      : status === "draft"
        ? "bg-amber-500/15 text-amber-400"
        : "bg-muted/30 text-muted-foreground";
  const label =
    status === "published"
      ? "Published"
      : status === "draft"
        ? "Draft"
        : "Empty";
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        cls
      )}
    >
      {status === "published" ? (
        <CheckCircle2 className="mr-1 inline h-3 w-3 -translate-y-px" />
      ) : null}
      {label}
    </span>
  );
}

function StatusDot({ status, active }: { status: WeekStatus; active: boolean }) {
  // The colour-coded centre of each cell in the mini week strip.
  const color =
    status === "published"
      ? "bg-emerald-400"
      : status === "draft"
        ? "bg-amber-400"
        : "bg-muted-foreground/30";
  return (
    <span
      className={cn(
        "block h-1.5 w-1.5 rounded-full",
        color,
        active && "ring-2 ring-primary/60 ring-offset-1 ring-offset-background"
      )}
    />
  );
}

// --- Main -------------------------------------------------------------------

export function ProgrammingWeekHeader({
  communityId,
  gymTimezone,
  weekStart,
  currentStatus,
}: Props) {
  const router = useRouter();
  const hasMounted = useHasMounted();

  const { data: nav } = useQuery<NavData>({
    queryKey: ["gym", communityId, "programming-nav", weekStart],
    queryFn: async () => {
      const res = await fetch(
        `/api/gym/${communityId}/programming/nav?weekStart=${weekStart}`
      );
      if (!res.ok) throw new Error("Failed to load nav");
      return res.json();
    },
  });

  // Surrounding weeks come from the API; override the current week's
  // status with the locally-known `currentStatus` so the strip never
  // shows a stale colour for the cell the coach is actively editing.
  const surrounding = useMemo(() => {
    if (!nav) return null;
    return nav.surrounding.map((w) =>
      w.weekStart === weekStart ? { ...w, status: currentStatus } : w
    );
  }, [nav, weekStart, currentStatus]);

  // Today's Monday in gym tz — only computed client-side to keep SSR
  // and the first client render byte-identical.
  const todaysMonday = useMemo(() => {
    if (!hasMounted) return null;
    return mondayOfDateInTz(new Date(), gymTimezone);
  }, [hasMounted, gymTimezone]);

  const diffWeeks =
    todaysMonday !== null ? weeksBetween(todaysMonday, weekStart) : null;

  const prevWeek = addDays(weekStart, -7);
  const nextWeek = addDays(weekStart, 7);
  const prevMonth = addDays(weekStart, -28);
  const nextMonth = addDays(weekStart, 28);

  const onPickDate = (raw: string) => {
    if (!raw) return;
    // <input type=date> returns a YYYY-MM-DD local-calendar date. Snap
    // it back to the Monday of that week and navigate.
    const snapped = mondayOfIso(raw);
    router.push(`/gym/programming/${snapped}`);
  };

  const quickJumps = useMemo(() => {
    if (todaysMonday === null) return [];
    return [
      { label: "This week", week: todaysMonday },
      { label: "Next week", week: addDays(todaysMonday, 7) },
      { label: "Last week", week: addDays(todaysMonday, -7) },
      { label: "4 weeks ago", week: addDays(todaysMonday, -28) },
      { label: "Same week last year", week: addDays(todaysMonday, -7 * 52) },
    ];
  }, [todaysMonday]);

  return (
    <div className="space-y-3 rounded-xl border border-border bg-muted/10 p-3">
      {/* Headline: date range + relative + status */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <CalendarDays className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-base font-semibold leading-tight sm:text-lg">
          {formatWeekRange(weekStart)}
        </h2>
        {hasMounted && diffWeeks !== null ? (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              diffWeeks === 0
                ? "bg-primary/15 text-primary"
                : diffWeeks === 1
                  ? "bg-primary/10 text-primary"
                  : "bg-muted/40 text-muted-foreground"
            )}
          >
            {relativeWeekLabel(diffWeeks)}
          </span>
        ) : null}
        <StatusPill status={currentStatus} />
      </div>

      {/* Nav row: month / week steppers + date picker + quick-jump menu */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1">
          <Link
            href={`/gym/programming/${prevMonth}`}
            aria-label="Previous month"
            title="Previous month (-4 weeks)"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-muted/30"
          >
            <ChevronsLeft className="h-4 w-4" />
          </Link>
          <Link
            href={`/gym/programming/${prevWeek}`}
            aria-label="Previous week"
            title="Previous week"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-muted/30"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
        </div>

        {/* Native date input overlay — matches the pattern in
            shared/date-navigator.tsx. Tapping the visible label focuses
            the hidden input, which opens the OS picker on mobile and we
            explicitly call showPicker() on desktop. */}
        <div className="relative flex flex-1 items-center justify-center">
          <button
            type="button"
            className="relative inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-muted/30"
          >
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Jump to date</span>
            <input
              type="date"
              value={weekStart}
              onClick={(e) => {
                const input = e.currentTarget;
                if (typeof input.showPicker === "function") {
                  try {
                    input.showPicker();
                  } catch {
                    // iOS / older browsers — focus handles it.
                  }
                }
              }}
              onChange={(e) => onPickDate(e.target.value)}
              aria-label="Jump to date"
              className="absolute inset-0 h-full w-full cursor-pointer appearance-none border-0 bg-transparent p-0 opacity-0"
            />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <Link
            href={`/gym/programming/${nextWeek}`}
            aria-label="Next week"
            title="Next week"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-muted/30"
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
          <Link
            href={`/gym/programming/${nextMonth}`}
            aria-label="Next month"
            title="Next month (+4 weeks)"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-muted/30"
          >
            <ChevronsRight className="h-4 w-4" />
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Jump to…"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-muted/30"
            >
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Jump to…</DropdownMenuLabel>
              {quickJumps.map((q) => (
                <DropdownMenuItem
                  key={q.label}
                  onClick={() => router.push(`/gym/programming/${q.week}`)}
                >
                  <span>{q.label}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {shortMonthDay(q.week)}
                  </span>
                </DropdownMenuItem>
              ))}
              {(nav?.nextEmptyBackward || nav?.nextEmptyForward) ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Find an empty week</DropdownMenuLabel>
                  {nav?.nextEmptyBackward ? (
                    <DropdownMenuItem
                      onClick={() =>
                        router.push(
                          `/gym/programming/${nav.nextEmptyBackward}`
                        )
                      }
                    >
                      <Rewind className="h-3.5 w-3.5" />
                      <span>Previous empty week</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {shortMonthDay(nav.nextEmptyBackward)}
                      </span>
                    </DropdownMenuItem>
                  ) : null}
                  {nav?.nextEmptyForward ? (
                    <DropdownMenuItem
                      onClick={() =>
                        router.push(`/gym/programming/${nav.nextEmptyForward}`)
                      }
                    >
                      <FastForward className="h-3.5 w-3.5" />
                      <span>Next empty week</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {shortMonthDay(nav.nextEmptyForward)}
                      </span>
                    </DropdownMenuItem>
                  ) : null}
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Mini week strip (±3 weeks). Cells link to that week; the dot
          color reflects the release status, and the active week is
          highlighted with a primary ring. */}
      {surrounding && surrounding.length > 0 ? (
        <div className="flex items-stretch gap-1">
          {surrounding.map((w) => {
            const isActive = w.weekStart === weekStart;
            return (
              <Link
                key={w.weekStart}
                href={`/gym/programming/${w.weekStart}`}
                className={cn(
                  "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg border px-1.5 py-1.5 text-center transition-colors",
                  isActive
                    ? "border-primary/40 bg-primary/10"
                    : "border-border/60 bg-background/40 hover:bg-muted/30"
                )}
                title={`Week of ${shortMonthDay(w.weekStart)} — ${
                  w.status === "empty" ? "empty" : w.status
                }`}
              >
                <span
                  className={cn(
                    "text-[10px] font-semibold uppercase",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  {shortMonthDay(w.weekStart)}
                </span>
                <StatusDot status={w.status} active={isActive} />
              </Link>
            );
          })}
        </div>
      ) : null}

      {/* Empty-week shortcuts. These are the headline "backfill" levers
          — surfaced as their own buttons (not just menu items) since
          they're the whole point of the redesign for coaches who need
          to fill in many months of history. */}
      {(nav?.nextEmptyBackward || nav?.nextEmptyForward) ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {nav?.nextEmptyBackward ? (
            <Link
              href={`/gym/programming/${nav.nextEmptyBackward}`}
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-border bg-background/40 px-2 py-1 text-muted-foreground hover:bg-muted/30 hover:text-foreground"
            >
              <Rewind className="h-3 w-3" />
              <span>Previous empty week</span>
              <span className="text-[10px] opacity-70">
                ({shortMonthDay(nav.nextEmptyBackward)})
              </span>
            </Link>
          ) : null}
          {nav?.nextEmptyForward ? (
            <Link
              href={`/gym/programming/${nav.nextEmptyForward}`}
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-border bg-background/40 px-2 py-1 text-muted-foreground hover:bg-muted/30 hover:text-foreground"
            >
              <FastForward className="h-3 w-3" />
              <span>Next empty week</span>
              <span className="text-[10px] opacity-70">
                ({shortMonthDay(nav.nextEmptyForward)})
              </span>
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

