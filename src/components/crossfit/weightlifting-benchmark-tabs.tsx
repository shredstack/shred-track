"use client";

import { Plus, Star, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  REP_MAX_TARGETS,
  type BenchmarkAttempt,
  type RepMaxTarget,
  type WeightliftingRepMaxVariant,
} from "@/types/crossfit";
import { formatShortDate } from "@/lib/format-date";

interface Props {
  variants: WeightliftingRepMaxVariant[];
  // Called when the athlete taps "Log a {N}RM" on a tab with no PR yet
  // (and on the always-visible "Log new attempt" button).
  onLogAttempt: (repTarget: RepMaxTarget) => void;
}

// Renders the 1RM / 2RM / 3RM / 5RM tab strip for a weightlifting benchmark.
// Each tab shows the PR card on top and a sorted history list below. Tabs
// where the athlete has no history yet show a CTA to log a first attempt.
export function WeightliftingBenchmarkTabs({ variants, onLogAttempt }: Props) {
  // Default to the lowest rep target the athlete has data for, falling back
  // to 1RM. Athletes who care about strength typically check 1RM first.
  const firstWithData = variants.find((v) => v.attempts.length > 0);
  const defaultTarget = (firstWithData?.repTarget ?? 1).toString();

  const variantsByTarget = new Map(
    variants.map((v) => [v.repTarget, v] as const)
  );

  return (
    <Tabs defaultValue={defaultTarget} className="w-full">
      <TabsList className="w-full">
        {REP_MAX_TARGETS.map((target) => {
          const v = variantsByTarget.get(target);
          return (
            <TabsTrigger key={target} value={target.toString()}>
              {target}RM
              {v && v.attempts.length > 0 && (
                <span className="ml-1 text-[10px] opacity-60">
                  · {v.attempts.length}
                </span>
              )}
            </TabsTrigger>
          );
        })}
      </TabsList>

      {REP_MAX_TARGETS.map((target) => {
        const v = variantsByTarget.get(target) ?? {
          repTarget: target,
          attempts: [],
          pr: null,
        };
        return (
          <TabsContent
            key={target}
            value={target.toString()}
            className="space-y-3"
          >
            {v.pr ? (
              <div className="flex items-center justify-between rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Trophy className="size-4 text-amber-400" />
                  <div className="flex flex-col">
                    <span className="text-base font-semibold text-amber-100">
                      {v.pr.weightLbs} lb
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      Set {formatShortDate(v.pr.workoutDate)}
                    </span>
                  </div>
                </div>
                <Badge className="border border-amber-500/30 bg-amber-500/15 text-amber-300 hover:bg-amber-500/15">
                  {target}RM PR
                </Badge>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-white/[0.06] py-4 text-center text-xs text-muted-foreground">
                No {target}RM logged yet — set your first one below.
              </div>
            )}

            {v.attempts.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {v.attempts.map((a) => (
                  <RepMaxAttemptRow key={a.scoreId} attempt={a} />
                ))}
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => onLogAttempt(target)}
            >
              <Plus className="size-4" />
              Log a {target}RM
            </Button>
          </TabsContent>
        );
      })}
    </Tabs>
  );
}

function RepMaxAttemptRow({ attempt }: { attempt: BenchmarkAttempt }) {
  const display =
    attempt.scoreText ??
    (attempt.weightLbs != null ? `${attempt.weightLbs} lb` : "—");
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">{display}</span>
        {attempt.isPR && (
          <Badge className="gap-1 border border-amber-500/30 bg-amber-500/15 text-amber-300 hover:bg-amber-500/15">
            <Star className="size-3" />
            PR
          </Badge>
        )}
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-xs text-muted-foreground">
          {formatShortDate(attempt.workoutDate)}
        </span>
        <Badge
          variant="outline"
          className="text-[10px] uppercase text-muted-foreground"
        >
          {attempt.division.replace("_", " ")}
        </Badge>
      </div>
    </div>
  );
}
