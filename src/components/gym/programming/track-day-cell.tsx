"use client";

// Single calendar cell for the track-day calendar (spec §1.3). Memoized
// so editing one day doesn't re-render every cell on the calendar.

import { memo } from "react";
import type { TrackDayRow } from "@/hooks/useTracks";

interface Props {
  date: string;
  isInRange: boolean;
  day: TrackDayRow | null;
  onClick: (date: string) => void;
}

function statusFor(day: TrackDayRow | null): {
  label: string;
  className: string;
} {
  if (!day) {
    return {
      label: "empty",
      className: "border-dashed border-white/10 text-muted-foreground/60",
    };
  }
  if (day.workoutId && (day.body?.trim() ?? "")) {
    return {
      label: "wod + body",
      className: "border-emerald-500/40 text-emerald-300",
    };
  }
  if (day.workoutId) {
    return {
      label: "workout",
      className: "border-emerald-500/40 text-emerald-300",
    };
  }
  if (day.body?.trim()) {
    return {
      label: "body",
      className: "border-cyan-500/40 text-cyan-300",
    };
  }
  return {
    label: "empty",
    className: "border-white/10 text-muted-foreground",
  };
}

export const TrackDayCell = memo(function TrackDayCell({
  date,
  isInRange,
  day,
  onClick,
}: Props) {
  const status = statusFor(day);
  const dayNumber = Number(date.slice(8, 10));
  const isToday = date === new Date().toISOString().slice(0, 10);

  return (
    <button
      type="button"
      onClick={() => isInRange && onClick(date)}
      disabled={!isInRange}
      className={
        "flex min-h-[72px] flex-col gap-1 rounded-md border p-2 text-left text-xs transition-colors " +
        (isInRange
          ? "bg-background hover:bg-muted/30 " + status.className
          : "border-transparent opacity-30")
      }
    >
      <div className="flex items-center justify-between">
        <span className={"font-mono " + (isToday ? "font-bold" : "")}>
          {dayNumber}
        </span>
        {isInRange && (
          <span className="rounded-full bg-white/[0.04] px-1.5 py-0.5 text-[9px] uppercase tracking-wider">
            {status.label}
          </span>
        )}
      </div>
      {day?.body && (
        <span className="line-clamp-2 text-[11px] text-foreground/80">
          {day.body}
        </span>
      )}
    </button>
  );
});
