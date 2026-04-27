"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, X, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface SuggestionResponse {
  hasSuggestion: boolean;
  planId: string | null;
  raceId: string | null;
  raceTitle: string | null;
  topStations: string[];
  weeksRemaining: number | null;
}

function useRecalibrationSuggestion() {
  return useQuery({
    queryKey: ["plan-recalibration-suggestion"],
    queryFn: async (): Promise<SuggestionResponse> => {
      const response = await fetch("/api/hyrox/plan/recalibration");
      if (!response.ok) throw new Error("Failed to fetch suggestion");
      return response.json();
    },
  });
}

function useApplyRecalibration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (planId: string) => {
      const response = await fetch(
        `/api/hyrox/plan/${planId}/recalibrate`,
        { method: "POST" },
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Failed to recalibrate");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["plan-recalibration-suggestion"],
      });
      queryClient.invalidateQueries({ queryKey: ["hyrox-plan-weeks"] });
      queryClient.invalidateQueries({ queryKey: ["hyrox-plan"] });
    },
  });
}

function useDismissRecalibration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (planId: string) => {
      const response = await fetch(
        `/api/hyrox/plan/${planId}/recalibrate`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Failed to dismiss");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["plan-recalibration-suggestion"],
      });
    },
  });
}

export function RecalibrationBanner() {
  const { data, isLoading } = useRecalibrationSuggestion();
  const apply = useApplyRecalibration();
  const dismiss = useDismissRecalibration();

  if (isLoading || !data?.hasSuggestion || !data.planId) return null;

  const stationList = data.topStations.length
    ? data.topStations.slice(0, 2).map((s, i, arr) => (
        <span key={s} className="font-semibold">
          {s}
          {i < arr.length - 1 ? " and " : ""}
        </span>
      ))
    : null;

  return (
    <Card className="border-primary/30 bg-primary/[0.04]">
      <CardContent className="py-3 px-4 flex flex-col gap-2">
        <div className="flex items-start gap-2">
          <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">
              Refresh upcoming weeks?
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Your latest race
              {data.raceTitle ? ` (${data.raceTitle})` : ""} shifted your
              weakest stations
              {stationList ? <> — focus on {stationList}.</> : "."}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            className="flex-1 gap-1 h-8"
            onClick={() => apply.mutate(data.planId!)}
            disabled={apply.isPending}
          >
            {apply.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {apply.isPending ? "Refreshing…" : "Refresh upcoming weeks"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 h-8"
            onClick={() => dismiss.mutate(data.planId!)}
            disabled={dismiss.isPending}
          >
            <X className="h-3.5 w-3.5" />
            Dismiss
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
