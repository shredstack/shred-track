"use client";

import { Flame } from "lucide-react";

interface Props {
  low?: number | null;
  high?: number | null;
  /** Single midpoint estimate (used on workout cards). Falls back to (low+high)/2. */
  midpoint?: number | null;
  confidence?: "high" | "medium" | "low" | null;
  /** Variant changes the typography and the tooltip copy. */
  variant?: "card" | "detail" | "score";
  className?: string;
}

const TOOLTIP: Record<NonNullable<Props["variant"]>, string> = {
  card: "Estimated calories burned for a 75 kg athlete. Personalized once you log a score.",
  detail:
    "Estimate based on movement MET values, time-in-movement, and a 75 kg reference athlete. Your number on save uses your bodyweight and ±20% real-world variance.",
  score:
    "Estimate based on movement type, duration, your bodyweight, vest, and RPE. Real burn varies ±20%.",
};

/**
 * Active-energy calorie estimate badge. Renders nothing when the estimate
 * hasn't been computed yet — workouts created moments ago haven't been
 * picked up by Inngest yet, and we don't show a skeleton or a "—".
 */
export function CalorieBadge({
  low,
  high,
  midpoint,
  confidence,
  variant = "card",
  className,
}: Props) {
  let display = "";
  if (variant === "detail" && low != null && high != null && low > 0 && high > 0) {
    display = `${low}–${high} kcal`;
  } else {
    const mid =
      midpoint ?? (low != null && high != null ? Math.round((low + high) / 2) : null);
    if (mid == null || mid <= 0) return null;
    display = `${mid} kcal`;
  }

  return (
    <span
      title={TOOLTIP[variant]}
      className={
        "inline-flex items-center gap-1 rounded-full border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-[11px] font-medium text-orange-200 " +
        (className ?? "")
      }
      aria-label={`Estimated calories: ${display}`}
    >
      <Flame className="h-3 w-3" />
      <span>Est. {display}</span>
      {confidence === "low" && (
        <span className="text-[9px] uppercase tracking-wide opacity-75">
          · low confidence
        </span>
      )}
    </span>
  );
}
