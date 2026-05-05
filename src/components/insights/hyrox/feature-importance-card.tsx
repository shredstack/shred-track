"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles, ChevronRight } from "lucide-react";
import { useInsightsFeatureImportance } from "@/hooks/useInsights";
import type { DivisionKey } from "@/lib/hyrox-data";

interface FeatureImportanceCardProps {
  division: DivisionKey;
}

const RATIO_LABELS: Record<string, string> = {
  ratio_sled_push_pull: "Sled Push ÷ Sled Pull",
  ratio_run1_run8: "Run 1 ÷ Run 8",
  ratio_burpees_wallballs: "Burpees ÷ Wall Balls",
  ratio_ski_row: "SkiErg ÷ Rowing",
  ratio_farmers_lunges: "Farmers ÷ Lunges",
};

function humanizeFeatureName(raw: string): string {
  if (raw.startsWith("station_")) {
    return raw
      .slice("station_".length)
      .split("_")
      .map((w) => (w === "skierg" ? "SkiErg" : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(" ");
  }
  if (raw.startsWith("run_")) {
    return `Run ${raw.slice("run_".length)}`;
  }
  return RATIO_LABELS[raw] ?? raw;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function FeatureImportanceCard({ division }: FeatureImportanceCardProps) {
  const { data, isLoading } = useInsightsFeatureImportance(division);
  const [howOpen, setHowOpen] = useState(false);
  const [racesOpen, setRacesOpen] = useState(false);

  const sortedFeatures = useMemo(() => {
    if (!data?.features) return [];
    return [...data.features]
      .sort((a, b) => b.importance - a.importance)
      .map((f) => ({ ...f, label: humanizeFeatureName(f.feature) }));
  }, [data]);

  if (isLoading) return <FeatureImportanceSkeleton />;

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

  const maxImportance = sortedFeatures[0]?.importance ?? 1;
  const top3 = sortedFeatures.slice(0, 3);
  const accuracy = data.metrics.accuracy;
  const within1 = data.metrics.within_1_bucket;
  const cvMean = data.metrics.cv_mean;
  const cvStd = data.metrics.cv_std;

  return (
    <Card className="gradient-border overflow-visible">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
          What Separates Finishers
        </CardTitle>
        <p className="text-[10px] text-muted-foreground">
          {data.trainingN.toLocaleString("en-US")} results · trained {formatDate(data.trainedAt)}
          {accuracy ? ` · ${Math.round(accuracy * 100)}% exact bucket` : ""}
          {within1 ? ` · ${Math.round(within1 * 100)}% within ±1` : ""}
        </p>
      </CardHeader>
      <CardContent className="pt-0 space-y-1.5">
        {sortedFeatures.map((feat) => (
          <div key={feat.feature} className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-24 text-right shrink-0 truncate">
              {feat.label}
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

        {top3.length === 3 && (
          <p className="text-xs text-muted-foreground pt-2 border-t border-white/[0.06] mt-2 leading-relaxed">
            In this division, the segments that vary most between fast and slow finishers are{" "}
            <span className="text-foreground">{top3[0].label}</span>,{" "}
            <span className="text-foreground">{top3[1].label}</span>, and{" "}
            <span className="text-foreground">{top3[2].label}</span>. Athletes quick at these tend to finish quickly overall.
          </p>
        )}

        <div className="pt-2 border-t border-white/[0.06]">
          <button
            type="button"
            onClick={() => setHowOpen((v) => !v)}
            aria-expanded={howOpen}
            className="flex w-full items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight
              className={`h-3 w-3 transition-transform ${howOpen ? "rotate-90" : ""}`}
            />
            How to read this
          </button>
          {howOpen && (
            <div className="mt-2 space-y-2 text-[11px] text-muted-foreground leading-relaxed">
              <p>
                <span className="text-foreground font-medium">The simple read.</span>{" "}
                Importance = how much each segment reveals about where an athlete lands in the field — not how much training that segment would drop your time. If your time at a high-importance segment is well above the division median, that&rsquo;s a signal you have time to find. The fix isn&rsquo;t always more reps of that station: late-race stations like Wall Balls also reflect your running engine, pacing, and how gassed you arrived.
              </p>
              <p>
                <span className="text-foreground font-medium">The technical read.</span>{" "}
                These percentages come from a Random Forest classifier trained on{" "}
                {data.trainingN.toLocaleString("en-US")} race results. It predicts which percentile bucket (0–20, 20–40, …, 80–100) an athlete falls into from their 16 segment times plus 5 derived ratios (e.g. sled push ÷ sled pull, run 1 ÷ run 8). Each percentage is the mean decrease in Gini impurity that feature contributes across the forest — i.e., how much knowing that segment time helps the trees split athletes into their actual bucket. Long, high-variance segments late in the race tend to score higher partly because they absorb fatigue from everything before them and offer wider spreads for the trees to split on. Read importance as{" "}
                <span className="text-foreground">informativeness</span>, not{" "}
                <span className="text-foreground">leverage</span>: it tells you which segments most reveal an athlete&rsquo;s overall fitness, not which would most reward training.
              </p>
              {cvMean !== undefined && (
                <p className="text-[10px]">
                  Cross-validated accuracy: {Math.round(cvMean * 100)}%
                  {cvStd !== undefined && ` (±${Math.round(cvStd * 100)}%)`} · 200 trees, max depth 10
                </p>
              )}
            </div>
          )}
        </div>

        <div>
          <button
            type="button"
            onClick={() => setRacesOpen((v) => !v)}
            aria-expanded={racesOpen}
            className="flex w-full items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight
              className={`h-3 w-3 transition-transform ${racesOpen ? "rotate-90" : ""}`}
            />
            Training data
          </button>
          {racesOpen && (
            <div className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
              {data.races.length > 0 ? (
                <>
                  <p className="mb-2">
                    Trained on {data.trainingN.toLocaleString("en-US")} results across{" "}
                    {data.races.length} race{data.races.length === 1 ? "" : "s"}:
                  </p>
                  <ul className="space-y-1 max-h-48 overflow-y-auto pr-1">
                    {data.races.map((race) => (
                      <li key={race.id} className="flex justify-between gap-2">
                        <span className="text-foreground truncate">{race.name}</span>
                        <span className="tabular-nums shrink-0">
                          {formatDate(race.eventDate)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>
                  Race detail isn&rsquo;t available for this model snapshot. It will populate after the next training run.
                </p>
              )}
            </div>
          )}
        </div>
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
