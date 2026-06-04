"use client";

import { AlertTriangle, Target } from "lucide-react";
import { useWorkoutPrepSignals } from "@/hooks/useWorkoutPrepSignals";
import type {
  ComplaintBanner,
  StretchGoalSignal,
} from "@/lib/crossfit/insights/prep-signals";

interface WorkoutPrepCardProps {
  workoutId: string;
  enabled: boolean;
}

// Workout-detail prep card — shows "last time you did this" stretch goals
// and movement-attributed complaint banners. Self-hides when the payload
// is empty so the parent doesn't need to gate on data availability.
export function WorkoutPrepCard({ workoutId, enabled }: WorkoutPrepCardProps) {
  const { data } = useWorkoutPrepSignals(workoutId, { enabled });
  if (!data) return null;
  const { stretchGoals, complaintBanners } = data;
  if (stretchGoals.length === 0 && complaintBanners.length === 0) return null;

  return (
    <div className="space-y-2 rounded-lg border border-fuchsia-500/15 bg-fuchsia-500/[0.03] p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-fuchsia-300/90">
        From your notes
      </p>

      {complaintBanners.length > 0 && (
        <div className="space-y-1.5">
          {complaintBanners.map((b) => (
            <ComplaintBannerRow key={`${b.movement}-${b.topic}`} item={b} />
          ))}
        </div>
      )}

      {stretchGoals.length > 0 && (
        <div className="space-y-1.5">
          {stretchGoals.map((g) => (
            <StretchGoalRow key={`${g.movement}-${g.metric}`} item={g} />
          ))}
        </div>
      )}
    </div>
  );
}

function ComplaintBannerRow({ item }: { item: ComplaintBanner }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-500/15 bg-amber-500/[0.04] px-2.5 py-1.5">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-xs text-foreground/90">
          Last time{" "}
          <span className="font-medium">{item.movement}</span> was in a WOD,
          you mentioned{" "}
          <span className="italic text-amber-200/90">
            &ldquo;{item.phrase}&rdquo;
          </span>
          .
        </p>
        {item.recommendation && (
          <p className="text-[11px] text-muted-foreground">
            {item.recommendation}
          </p>
        )}
      </div>
    </div>
  );
}

function StretchGoalRow({ item }: { item: StretchGoalSignal }) {
  const best = formatSignalValue(item.bestValue, item.bestUnit, item.bestWindow);
  const stretch = formatSignalValue(item.stretchValue, item.stretchUnit, null);
  return (
    <div className="flex items-start gap-2 text-xs">
      <Target className="mt-0.5 size-3.5 shrink-0 text-fuchsia-400" />
      <p className="min-w-0 flex-1 text-foreground/90">
        <span className="font-medium">{item.movement}</span>
        <span className="text-muted-foreground"> — recent best: </span>
        <span className="font-mono">{best}</span>
        <span className="text-muted-foreground">
          {" "}
          ({shortDate(item.bestWorkoutDate)}). Stretch goal:{" "}
        </span>
        <span className="font-mono text-fuchsia-300">{stretch}</span>
        <span className="text-muted-foreground">.</span>
      </p>
    </div>
  );
}

// Pace-style signals are stored in seconds — render them mm:ss when
// they're long enough to be ambiguous. Other units render as-is.
function formatSignalValue(
  value: number,
  unit: string,
  window: string | null
): string {
  const base =
    unit === "sec" && value >= 60
      ? formatMmSs(value)
      : `${formatNumber(value)} ${unit}`;
  return window ? `${base} in ${window}` : base;
}

function formatMmSs(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? n.toString() : n.toFixed(1);
}

function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
