"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users } from "lucide-react";
import { useInsightsComparisons } from "@/hooks/useInsights";
import type { DivisionKey } from "@/lib/hyrox-data";
import { formatTime } from "@/lib/hyrox-data";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";

interface ComparisonsCardProps {
  division: DivisionKey;
  eventId?: string;
}

export function ComparisonsCard({ division, eventId }: ComparisonsCardProps) {
  const { data, isLoading } = useInsightsComparisons(division, eventId);
  const [viewType, setViewType] = useState<"station" | "run">("station");

  const chartData = useMemo(() => {
    if (!data) return [];

    const filter = viewType === "station" ? "station" : "run";

    // Build a map of segment → { top20, average, bottom20 }
    const map = new Map<string, { top20: number; average: number; bottom20: number }>();

    for (const seg of data.average || []) {
      if (seg.segmentType !== filter) continue;
      map.set(seg.segmentLabel, {
        top20: 0,
        average: Math.round(seg.meanSeconds),
        bottom20: 0,
      });
    }

    for (const seg of data.top20 || []) {
      if (seg.segmentType !== filter) continue;
      const entry = map.get(seg.segmentLabel);
      if (entry) entry.top20 = Math.round(seg.meanSeconds);
    }

    for (const seg of data.bottom20 || []) {
      if (seg.segmentType !== filter) continue;
      const entry = map.get(seg.segmentLabel);
      if (entry) entry.bottom20 = Math.round(seg.meanSeconds);
    }

    return Array.from(map.entries())
      .map(([label, vals]) => ({
        label: label.replace("Broad Jump Burpees", "BBJ"),
        ...vals,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [data, viewType]);

  if (!eventId) {
    return (
      <Card className="gradient-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Users className="h-3.5 w-3.5 text-muted-foreground" />
            Top vs. Field vs. Bottom
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground text-center py-6">
            Select a specific event to see how the top 20 compare to the bottom 20.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return <ComparisonsSkeleton />;
  }

  return (
    <Card className="gradient-border overflow-visible">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Users className="h-3.5 w-3.5 text-muted-foreground" />
          Top vs. Field vs. Bottom
        </CardTitle>
        <div className="flex gap-1 mt-1">
          {(["station", "run"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setViewType(t)}
              className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition-all ${
                viewType === t
                  ? "bg-primary/15 text-primary"
                  : "bg-white/[0.06] text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "station" ? "Stations" : "Runs"}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {chartData.length > 0 ? (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 32, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 9, fill: "rgba(255,255,255,0.5)" }}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                  interval={0}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }}
                  tickFormatter={(v: number) => formatTime(v)}
                  width={48}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "rgba(0,0,0,0.85)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                  formatter={(value) => [formatTime(Number(value)), ""]}
                />
                <Legend
                  wrapperStyle={{ fontSize: "10px" }}
                />
                <Bar dataKey="top20" fill="#34d399" name="Top 20" radius={[2, 2, 0, 0]} />
                <Bar dataKey="average" fill="#60a5fa" name="Field Avg" radius={[2, 2, 0, 0]} />
                <Bar dataKey="bottom20" fill="#fb923c" name="Bottom 20" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-6">
            No comparison data available for this event.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ComparisonsSkeleton() {
  return (
    <Card className="gradient-border">
      <CardHeader className="pb-2">
        <div className="h-4 w-44 rounded bg-white/[0.04] animate-pulse" />
      </CardHeader>
      <CardContent>
        <div className="h-72 w-full rounded bg-white/[0.04] animate-pulse" />
      </CardContent>
    </Card>
  );
}
