"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles } from "lucide-react";
import { useInsightsFeatureImportance } from "@/hooks/useInsights";
import type { DivisionKey } from "@/lib/hyrox-data";

interface FeatureImportanceCardProps {
  division: DivisionKey;
}

export function FeatureImportanceCard({ division }: FeatureImportanceCardProps) {
  const { data, isLoading } = useInsightsFeatureImportance(division);

  const sortedFeatures = useMemo(() => {
    if (!data?.features) return [];
    return [...data.features].sort((a, b) => b.importance - a.importance);
  }, [data]);

  const narrative = useMemo(() => {
    if (sortedFeatures.length < 3) return null;
    const top3 = sortedFeatures.slice(0, 3).map((f) => f.feature);
    return `The biggest predictors of your finish percentile are ${top3[0]}, ${top3[1]}, and ${top3[2]}. Improving these areas will have the highest impact on your overall time.`;
  }, [sortedFeatures]);

  if (isLoading) {
    return <FeatureImportanceSkeleton />;
  }

  if (!data) {
    return (
      <Card className="gradient-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
            What Separates Finishers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground text-center py-6">
            No trained model available for this division yet. This will unlock after our first model training run.
          </p>
        </CardContent>
      </Card>
    );
  }

  const maxImportance = sortedFeatures[0]?.importance || 1;

  return (
    <Card className="gradient-border overflow-visible">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
          What Separates Finishers
        </CardTitle>
        <p className="text-[10px] text-muted-foreground">
          Based on {data.trainingN.toLocaleString("en-US")} results
          {data.metrics.accuracy
            ? ` · Model accuracy: ${Math.round(data.metrics.accuracy * 100)}% (±1 bucket)`
            : ""}
        </p>
      </CardHeader>
      <CardContent className="pt-0 space-y-1.5">
        {sortedFeatures.map((feat) => (
          <div key={feat.feature} className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-24 text-right shrink-0 truncate">
              {feat.feature}
            </span>
            <div className="flex-1 h-5 bg-white/[0.03] rounded-sm overflow-hidden">
              <div
                className="h-full bg-primary/30 rounded-sm transition-all duration-500"
                style={{ width: `${(feat.importance / maxImportance) * 100}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground tabular-nums w-10">
              {(feat.importance * 100).toFixed(1)}%
            </span>
          </div>
        ))}

        {narrative && (
          <p className="text-xs text-muted-foreground pt-2 border-t border-white/[0.06] mt-2 leading-relaxed">
            {narrative}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function FeatureImportanceSkeleton() {
  return (
    <Card className="gradient-border">
      <CardHeader className="pb-2">
        <div className="h-4 w-40 rounded bg-white/[0.04] animate-pulse" />
      </CardHeader>
      <CardContent className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-5 rounded bg-white/[0.04] animate-pulse" />
        ))}
      </CardContent>
    </Card>
  );
}
