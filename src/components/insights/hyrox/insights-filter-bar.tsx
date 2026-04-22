"use client";

import { useInsightsEvents } from "@/hooks/useInsights";
import { type DivisionKey } from "@/lib/hyrox-data";
import { AlertCircle } from "lucide-react";
import { DivisionPicker } from "@/components/shared/division-picker";

interface InsightsFilterBarProps {
  division: DivisionKey;
  onDivisionChange: (d: DivisionKey) => void;
  eventId: string | undefined;
  onEventChange: (id: string | undefined) => void;
}

const INSIGHTS_DIVISION_KEYS: DivisionKey[] = [
  "men_open",
  "women_open",
  "men_pro",
  "women_pro",
];

export function InsightsFilterBar({
  division,
  onDivisionChange,
  eventId,
  onEventChange,
}: InsightsFilterBarProps) {
  const { data: events } = useInsightsEvents();

  return (
    <div className="sticky top-0 z-10 flex flex-col gap-3 rounded-xl bg-background/80 backdrop-blur-md p-3 border border-white/[0.06]">
      {/* Division picker — inline pills since ≤6 keys */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <DivisionPicker
            value={division}
            onChange={onDivisionChange}
            allowedKeys={INSIGHTS_DIVISION_KEYS}
          />
        </div>

        {/* Disclaimer pill */}
        <div className="flex items-center gap-1 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[10px] text-amber-400 whitespace-nowrap shrink-0">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span>Growing dataset</span>
        </div>
      </div>

      {/* Event dropdown */}
      <select
        value={eventId ?? ""}
        onChange={(e) => onEventChange(e.target.value || undefined)}
        className="w-full rounded-lg bg-white/[0.06] border border-white/[0.08] px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
      >
        <option value="">All events (last 2 years)</option>
        {events?.map((ev) => (
          <option key={ev.id} value={ev.id}>
            {ev.name}
          </option>
        ))}
      </select>
    </div>
  );
}
