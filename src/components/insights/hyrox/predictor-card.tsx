"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Target, RefreshCw, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { formatLongTime } from "@/lib/hyrox-data";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface Prediction {
  predictedFinishSeconds: number;
  predictedFinishLow: number;
  predictedFinishHigh: number;
  percentile: number;
  confidence: number;
  contributingSignals: Record<string, unknown>;
  bottleneckStation: string | null;
  bottleneckSavingsSeconds: number | null;
  updatedAt: string;
}

export function PredictorCard() {
  const [showExplainer, setShowExplainer] = useState(false);
  const queryClient = useQueryClient();

  // Load cached prediction
  const { data: prediction, isLoading } = useQuery<Prediction | null>({
    queryKey: ["hyrox-prediction"],
    queryFn: async () => {
      const res = await fetch("/api/hyrox/predict");
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch prediction");
      return res.json();
    },
  });

  // Refresh prediction
  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/hyrox/predict", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to generate prediction");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hyrox-prediction"] });
    },
  });

  const confidenceLabel = (c: number) => {
    if (c >= 0.7) return { text: "High", color: "text-emerald-400" };
    if (c >= 0.4) return { text: "Medium", color: "text-amber-400" };
    return { text: "Low", color: "text-red-400" };
  };

  const timeAgo = (dateStr: string) => {
    const ms = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  if (isLoading) {
    return <PredictorSkeleton />;
  }

  // Empty state: no prediction yet
  if (!prediction) {
    return (
      <Card className="gradient-border overflow-visible">
        <CardContent className="flex flex-col items-center gap-4 py-10 bg-mesh rounded-xl">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <Target className="h-6 w-6 text-primary" />
          </div>
          <div className="text-center">
            <p className="font-bold text-lg">Finish Time Predictor</p>
            <p className="mt-2 max-w-xs text-sm text-muted-foreground leading-relaxed">
              Get a projected HYROX finish time based on your logged training, benchmarks, and paces.
            </p>
          </div>
          <Button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            className="mt-2"
          >
            {refreshMutation.isPending ? (
              <RefreshCw className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Target className="h-4 w-4 mr-2" />
            )}
            Run my first estimate
          </Button>
          {refreshMutation.isError && (
            <p className="text-xs text-red-400 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {refreshMutation.error.message}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  const conf = confidenceLabel(prediction.confidence);

  return (
    <Card className="gradient-border overflow-visible">
      <CardHeader className="pb-1">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Target className="h-3.5 w-3.5 text-muted-foreground" />
            Finish Time Predictor
          </CardTitle>
          <span className="text-[10px] text-muted-foreground">
            Last updated {timeAgo(prediction.updatedAt)}
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {/* Big number */}
        <div className="text-center">
          <p className="text-3xl font-bold tabular-nums text-gradient-primary">
            {formatLongTime(prediction.predictedFinishSeconds)}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Likely between {formatLongTime(prediction.predictedFinishLow)} and{" "}
            {formatLongTime(prediction.predictedFinishHigh)}
          </p>
        </div>

        {/* Confidence + percentile row */}
        <div className="flex items-center justify-center gap-4 text-xs">
          <span>
            Confidence: <span className={conf.color}>{conf.text}</span>
          </span>
          <span className="text-muted-foreground">·</span>
          <span>
            Top <span className="text-primary tabular-nums">{Math.round(100 - prediction.percentile)}%</span>
          </span>
        </div>

        {/* Bottleneck callout */}
        {prediction.bottleneckStation && prediction.bottleneckSavingsSeconds && (
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-2.5 text-xs">
            <span className="font-medium text-amber-400">Biggest lever:</span>{" "}
            <span className="text-foreground">{prediction.bottleneckStation}</span>
            <span className="text-muted-foreground">
              {" "}
              — getting to the 75th-percentile time would save ~
              {formatLongTime(prediction.bottleneckSavingsSeconds)}
            </span>
          </div>
        )}

        {/* Refresh button */}
        <Button
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          variant="outline"
          size="sm"
          className="w-full"
        >
          {refreshMutation.isPending ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          )}
          Refresh estimate
        </Button>

        {refreshMutation.isError && (
          <p className="text-xs text-red-400 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {refreshMutation.error.message}
          </p>
        )}

        {/* How is this calculated? */}
        <button
          onClick={() => setShowExplainer(!showExplainer)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {showExplainer ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          How is this calculated?
        </button>
        {showExplainer && (
          <div className="text-[10px] text-muted-foreground leading-relaxed bg-white/[0.03] rounded-lg p-2.5">
            Your estimate combines a synthetic calculation (your station benchmarks + run paces
            with fatigue modeling) with a machine learning model trained on thousands of real HYROX
            results. The more training data you log, the more weight goes to the ML model. The
            confidence range reflects how much data we have to work with — log more sessions to
            narrow it down.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PredictorSkeleton() {
  return (
    <Card className="gradient-border">
      <CardHeader className="pb-2">
        <div className="h-4 w-36 rounded bg-white/[0.04] animate-pulse" />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="h-10 w-32 mx-auto rounded bg-white/[0.04] animate-pulse" />
        <div className="h-4 w-48 mx-auto rounded bg-white/[0.04] animate-pulse" />
        <div className="h-12 rounded bg-white/[0.04] animate-pulse" />
      </CardContent>
    </Card>
  );
}
