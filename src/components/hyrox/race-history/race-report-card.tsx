"use client";

import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Loader2, RefreshCw, Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatLongTime, formatTime } from "@/lib/hyrox-data";
import { PercentileChip } from "./percentile-chip";

// ---------------------------------------------------------------------------
// Types — match the JSONB shapes set by the Inngest generator
// ---------------------------------------------------------------------------

export interface TimeLossEntry {
  station: string;
  secondsLost: number;
  percentile?: number;
  p25Time?: number;
}

export interface FocusEntry {
  focus: string;
  rationale: string;
  sessionsPerWeek: number;
  durationWeeks: number;
}

export interface RaceReport {
  id: string;
  raceId: string;
  status: "pending" | "generating" | "completed" | "failed";
  headline: string | null;
  pacingAnalysis: string | null;
  timeLossRanking: TimeLossEntry[] | null;
  prioritizedFocus: FocusEntry[] | null;
  projectedFinishSeconds: number | null;
  projectedFinishAssumptions: string | null;
  aiModel: string | null;
  generationStartedAt: string | null;
  generationCompletedAt: string | null;
  generationError: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

function useRaceReport(raceId: string) {
  return useQuery({
    queryKey: ["practice-races", "report", raceId],
    queryFn: async (): Promise<RaceReport | null> => {
      const response = await fetch(
        `/api/hyrox/practice-races/${raceId}/report`,
      );
      if (response.status === 404) return null;
      if (!response.ok && response.status !== 202) {
        throw new Error("Failed to fetch report");
      }
      return response.json();
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "pending" || status === "generating") return 3000;
      return false;
    },
  });
}

function useGenerateReport(raceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `/api/hyrox/practice-races/${raceId}/report`,
        { method: "POST" },
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Failed to start generation");
      }
      return response.json() as Promise<RaceReport>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["practice-races", "report", raceId],
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  raceId: string;
  /** Current finish time in seconds, used to render the projected finish callout. */
  currentFinishSeconds: number;
}

export function RaceReportCard({ raceId, currentFinishSeconds }: Props) {
  const { data: report, isLoading, refetch } = useRaceReport(raceId);
  const generate = useGenerateReport(raceId);

  // If we have no report at all, don't auto-fire — let the user opt in via CTA.
  const status = report?.status ?? null;

  // Auto-refetch once after generating completes (covers cache races).
  useEffect(() => {
    if (status === "completed") refetch();
  }, [status, refetch]);

  const projectedDelta =
    report?.projectedFinishSeconds != null
      ? Math.round(currentFinishSeconds - report.projectedFinishSeconds)
      : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          AI Race Report
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isLoading && (
          <div className="flex items-center justify-center py-6 text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-xs">Loading…</span>
          </div>
        )}

        {!isLoading && !report && (
          <div className="flex flex-col items-center gap-3 py-2">
            <p className="text-xs text-muted-foreground text-center">
              Get an AI debrief: where you lost time, pacing read, and a focused
              plan to drop minutes.
            </p>
            <Button
              size="sm"
              className="gap-2"
              onClick={() => generate.mutate()}
              disabled={generate.isPending}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {generate.isPending ? "Starting…" : "Generate AI race report"}
            </Button>
          </div>
        )}

        {(status === "pending" || status === "generating") && (
          <div className="flex flex-col items-center gap-2 py-4">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <p className="text-xs text-muted-foreground">
              Analyzing your race…
            </p>
          </div>
        )}

        {status === "failed" && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-red-400">
              Report generation failed
              {report?.generationError ? `: ${report.generationError}` : "."}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="gap-2 self-start"
              onClick={() => generate.mutate()}
              disabled={generate.isPending}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </Button>
          </div>
        )}

        {status === "completed" && report && (
          <div className="flex flex-col gap-3">
            {/* Headline */}
            {report.headline && (
              <p className="text-sm font-semibold">{report.headline}</p>
            )}

            {/* Pacing analysis */}
            {report.pacingAnalysis && (
              <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                {report.pacingAnalysis}
              </p>
            )}

            {/* Time loss ranking */}
            {report.timeLossRanking && report.timeLossRanking.length > 0 && (
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Where time was lost
                </p>
                <div className="flex flex-col gap-1.5">
                  {report.timeLossRanking.map((row) => (
                    <div
                      key={row.station}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span className="flex-1 min-w-0 truncate font-medium">
                        {row.station}
                      </span>
                      {row.percentile != null && (
                        <PercentileChip percentile={row.percentile} />
                      )}
                      <span className="font-mono tabular-nums w-12 text-right text-red-400">
                        +{Math.round(row.secondsLost)}s
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Prioritized focus */}
            {report.prioritizedFocus && report.prioritizedFocus.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Where to focus
                </p>
                {report.prioritizedFocus.map((item, i) => (
                  <div
                    key={i}
                    className="rounded-lg bg-primary/[0.06] border border-primary/15 p-3"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="text-xs font-semibold">{item.focus}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {item.sessionsPerWeek}×/wk · {item.durationWeeks} wks
                      </p>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {item.rationale}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Projected finish */}
            {report.projectedFinishSeconds != null && (
              <div className="rounded-lg bg-emerald-500/[0.08] border border-emerald-500/20 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Target className="h-3.5 w-3.5 text-emerald-400" />
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
                    Projected finish
                  </p>
                </div>
                <p className="text-lg font-mono font-bold tabular-nums">
                  {formatLongTime(report.projectedFinishSeconds)}
                  {projectedDelta != null && projectedDelta > 0 && (
                    <span className="ml-2 text-sm font-mono text-emerald-400">
                      −{formatTime(projectedDelta)}
                    </span>
                  )}
                </p>
                {report.projectedFinishAssumptions && (
                  <p className="text-[11px] mt-1 text-muted-foreground leading-relaxed">
                    {report.projectedFinishAssumptions}
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                className="gap-1 h-7 text-[11px]"
                onClick={() => generate.mutate()}
                disabled={generate.isPending}
              >
                <RefreshCw className="h-3 w-3" />
                Regenerate
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
