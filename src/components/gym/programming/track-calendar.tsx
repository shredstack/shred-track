"use client";

// Calendar grid for the track detail page (spec §1.3). Mobile-first —
// renders a scrollable list of week rows. Each cell is a `TrackDayCell`.

import { useCallback, useMemo, useState } from "react";
import { TrackDayCell } from "@/components/gym/programming/track-day-cell";
import { TrackDayEditorSheet } from "@/components/gym/programming/track-day-editor-sheet";
import type { TrackDayRow } from "@/hooks/useTracks";
import type { TrackKind } from "@/types/programming-tracks";

interface Props {
  communityId: string;
  trackId: string;
  trackKind: TrackKind;
  startsOn: string;
  endsOn: string;
  days: TrackDayRow[];
}

function isoFromDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseIso(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function startOfWeekSunday(d: Date): Date {
  const out = new Date(d);
  const dow = out.getUTCDay();
  out.setUTCDate(out.getUTCDate() - dow);
  return out;
}

const DOW_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function TrackCalendar({
  communityId,
  trackId,
  trackKind,
  startsOn,
  endsOn,
  days,
}: Props) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const dayByDate = useMemo(() => {
    const m = new Map<string, TrackDayRow>();
    for (const d of days) m.set(d.date, d);
    return m;
  }, [days]);

  const rows = useMemo(() => {
    const start = parseIso(startsOn);
    const end = parseIso(endsOn);
    const gridStart = startOfWeekSunday(start);
    const totalSlots = Math.ceil((diffDays(gridStart, end) + 1) / 7) * 7;
    const slots: string[] = [];
    for (let i = 0; i < totalSlots; i++) {
      const d = new Date(gridStart.getTime() + i * 86_400_000);
      slots.push(isoFromDate(d));
    }
    const weeks: string[][] = [];
    for (let i = 0; i < slots.length; i += 7) {
      weeks.push(slots.slice(i, i + 7));
    }
    return weeks;
  }, [startsOn, endsOn]);

  const isInRange = useCallback(
    (iso: string) => iso >= startsOn && iso <= endsOn,
    [startsOn, endsOn]
  );

  const handleCellClick = useCallback((iso: string) => {
    setSelectedDate(iso);
  }, []);

  const existingDay = selectedDate ? dayByDate.get(selectedDate) ?? null : null;

  return (
    <>
      <div className="space-y-2">
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-wider text-muted-foreground">
          {DOW_HEADERS.map((h) => (
            <div key={h}>{h}</div>
          ))}
        </div>
        <div className="space-y-1">
          {rows.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 gap-1">
              {week.map((iso) => (
                <TrackDayCell
                  key={iso}
                  date={iso}
                  isInRange={isInRange(iso)}
                  day={dayByDate.get(iso) ?? null}
                  onClick={handleCellClick}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      {selectedDate && (
        <TrackDayEditorSheet
          open={!!selectedDate}
          onOpenChange={(open) => {
            if (!open) setSelectedDate(null);
          }}
          communityId={communityId}
          trackId={trackId}
          trackKind={trackKind}
          date={selectedDate}
          existingDay={existingDay}
        />
      )}
    </>
  );
}
