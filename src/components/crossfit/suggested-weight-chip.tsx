"use client";

import { useState } from "react";
import { Info, Sparkles } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import type { SuggestionDTO } from "@/hooks/useSuggestedWeights";

// Suggested-weight chip + "Why?" sheet. Renders nothing unless the engine
// returned a concrete band. The "post-score-log" hide behavior is handled
// at the caller — the chip itself doesn't know whether a score exists yet.

function formatBand(lowLb: number, highLb: number): string {
  if (lowLb <= 0 || highLb <= 0) return "—";
  if (lowLb === highLb) return `${formatLb(lowLb)} lb`;
  return `${formatLb(lowLb)}–${formatLb(highLb)} lb`;
}

function formatLb(n: number): string {
  // Whole numbers display without a decimal; 62.5 keeps its half.
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

const METHOD_LABEL: Record<SuggestionDTO["method"] | string, string> = {
  direct_template_history: "Based on your last attempt on this workout.",
  logged_1rm: "Based on your logged 1RM.",
  estimated_1rm: "Estimated from your heaviest logged set.",
  similar_template_history: "Averaged from your prior similar-stimulus sets.",
  rx_fallback: "Starting point — using the gym Rx baseline.",
  unavailable: "",
};

const STIMULUS_LABEL: Record<string, string> = {
  strength_heavy: "Heavy strength",
  strength_moderate: "Moderate strength",
  short_intense: "Short / intense metcon",
  moderate_metcon: "Moderate metcon",
  long_metcon: "Long metcon",
  oly_metcon: "Olympic-flavored metcon",
};

export function SuggestionChip({
  suggestion,
  movementName,
}: {
  suggestion: SuggestionDTO | null;
  movementName: string;
}) {
  const [open, setOpen] = useState(false);

  if (!suggestion) return null;
  if (suggestion.method === "unavailable") return null;
  if (suggestion.lowLb <= 0 && suggestion.highLb <= 0) return null;

  const isLow = suggestion.confidence === "low";
  const band = formatBand(suggestion.lowLb, suggestion.highLb);
  const prefix = isLow ? "Starting point" : "You";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`mt-1 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
          isLow
            ? "border-border/30 bg-muted/30 text-muted-foreground/80 hover:bg-muted/50"
            : "border-cyan-500/30 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/15"
        }`}
        aria-label={`Suggested ${band} for ${movementName}`}
      >
        <Sparkles className="size-2.5" />
        <span>{prefix}: </span>
        <span className="font-mono">{band}</span>
        <Info className="ml-0.5 size-2.5 opacity-60" />
      </button>
      {open && (
        <WhySheet
          open={open}
          onOpenChange={setOpen}
          suggestion={suggestion}
          movementName={movementName}
        />
      )}
    </>
  );
}

function WhySheet({
  open,
  onOpenChange,
  suggestion,
  movementName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestion: SuggestionDTO;
  movementName: string;
}) {
  const band = formatBand(suggestion.lowLb, suggestion.highLb);
  const methodCopy = METHOD_LABEL[suggestion.method] ?? "";
  const stimulusCopy = suggestion.stimulusClass
    ? STIMULUS_LABEL[suggestion.stimulusClass]
    : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[75vh] overflow-y-auto rounded-t-2xl"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-cyan-300" />
            Suggested: <span className="font-mono">{band}</span>
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            {movementName}
          </p>
        </SheetHeader>
        <div className="space-y-4 p-4 pt-0">
          <Section title="Why this range">
            {methodCopy && (
              <p className="text-sm text-foreground/85">{methodCopy}</p>
            )}
            {stimulusCopy && (
              <p className="text-xs text-muted-foreground">
                Workout stimulus: <strong>{stimulusCopy}</strong>
              </p>
            )}
          </Section>

          {suggestion.anchor1rmLb != null && (
            <Section title="Anchor">
              <div className="rounded-lg border border-border/40 bg-muted/20 p-3 text-sm">
                <div className="font-mono font-semibold">
                  {Math.round(suggestion.anchor1rmLb)} lb
                  <span className="ml-2 text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
                    1RM
                  </span>
                </div>
                {suggestion.anchorSource && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {suggestion.anchorSource}
                  </p>
                )}
              </div>
            </Section>
          )}

          {!suggestion.anchor1rmLb && suggestion.anchorSource && (
            <Section title="Source">
              <p className="text-xs text-muted-foreground">
                {suggestion.anchorSource}
              </p>
            </Section>
          )}

          <Section title="Confidence">
            <Badge
              variant="outline"
              className={
                suggestion.confidence === "high"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : suggestion.confidence === "medium"
                    ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-200"
                    : "border-border/40 bg-muted/30 text-muted-foreground"
              }
            >
              {suggestion.confidence}
            </Badge>
            {suggestion.confidence !== "high" && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {suggestion.confidence === "medium"
                  ? "Based on limited data — log a few more weighted sets to tighten this."
                  : "We&apos;re inferring from the gym Rx baseline. Pick what feels right; the next score you log will personalize the suggestion."}
              </p>
            )}
          </Section>

          <p className="text-[10px] text-muted-foreground/70">
            Suggestions are a starting point, not a prescription. You pick;
            we inform.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}
