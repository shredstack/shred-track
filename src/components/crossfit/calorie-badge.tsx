"use client";

import Link from "next/link";
import { Flame } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Variant = "card" | "detail" | "score";
type Confidence = "high" | "medium" | "low";

interface Props {
  low?: number | null;
  high?: number | null;
  /** Single midpoint estimate (used on workout cards). Falls back to (low+high)/2. */
  midpoint?: number | null;
  confidence?: Confidence | null;
  /** Variant changes the typography and the explainer's leading line. */
  variant?: Variant;
  className?: string;
}

const LEADING_LINE: Record<Variant, string> = {
  card:
    "An estimate for a 75 kg reference athlete — your number will scale to your bodyweight once you log a score.",
  detail:
    "The range reflects roughly ±15% real-world variance around the MET model.",
  score:
    "Personalized using your bodyweight, vest, RPE, and your working load relative to your 1RM.",
};

/**
 * Active-energy calorie estimate badge. Renders nothing when the estimate
 * hasn't been computed yet — workouts created moments ago haven't been
 * picked up by Inngest yet, and we don't show a skeleton or a "—".
 *
 * Tapping opens an inline explainer of the model with a link to the full
 * help page. Tap-to-open is used (not hover/title) because HTML title
 * tooltips don't surface in the Capacitor iOS WebView.
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
    <Dialog>
      <DialogTrigger
        // Stop the tap bubbling up so the badge doesn't also activate a
        // parent card/link wrapping it.
        onClick={(e) => e.stopPropagation()}
        aria-label={`Estimated calories: ${display}. Tap for details.`}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-[11px] font-medium text-orange-200 transition-colors hover:bg-orange-500/15 active:bg-orange-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40",
          className
        )}
      >
        <Flame className="h-3 w-3" />
        <span>Est. {display}</span>
        {confidence === "low" && (
          <span className="text-[9px] uppercase tracking-wide opacity-75">
            · low confidence
          </span>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>How this is calculated</DialogTitle>
        </DialogHeader>
        <ExplainerBody variant={variant} confidence={confidence ?? null} />
      </DialogContent>
    </Dialog>
  );
}

function ExplainerBody({
  variant,
  confidence,
}: {
  variant: Variant;
  confidence: Confidence | null;
}) {
  return (
    <div className="space-y-3 text-sm text-muted-foreground">
      <p>{LEADING_LINE[variant]}</p>
      <div className="rounded-md border border-border bg-muted/40 p-3">
        <p className="font-mono text-xs text-foreground">
          kcal ≈ MET × bodyweight × duration
        </p>
      </div>
      <ul className="list-disc space-y-1 pl-4">
        <li>
          <span className="text-foreground">Active</span> calories strip out the
          energy you’d burn at rest — same number Apple Health tracks.
        </li>
        <li>
          <span className="text-foreground">MET</span> is the movement’s
          intensity (heavy lifts ≈ 5–6, burpees ≈ 11, sprints ≈ 15+).
        </li>
        <li>
          <span className="text-foreground">Modifiers</span> nudge the estimate
          for load vs. your 1RM, vest, RPE, and unbroken-complex timing.
        </li>
        <li>
          <span className="text-foreground">EPOC</span> (afterburn) is an
          optional multiplier you can toggle in your profile.
        </li>
      </ul>
      {confidence === "low" && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">
          <span className="font-medium">Low confidence</span> — the estimate is
          leaning on population defaults. Adding your bodyweight and logging
          RPE will tighten it.
        </p>
      )}
      <p className="pt-1">
        <Link
          href="/help/calories"
          className="text-orange-300 hover:underline"
        >
          Read the full explanation →
        </Link>
      </p>
    </div>
  );
}
