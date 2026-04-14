"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity } from "lucide-react";
import { useInsightsAverages } from "@/hooks/useInsights";
import type { DivisionKey } from "@/lib/hyrox-data";
import { formatTime } from "@/lib/hyrox-data";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface PaceProfileCardProps {
  division: DivisionKey;
  eventId?: string;
  userOverlay?: Array<{ segmentLabel: string; timeSeconds: number }> | null;
}

export function PaceProfileCard({ division, eventId, userOverlay }: PaceProfileCardProps) {
  const { data, isLoading } = useInsightsAverages(division, eventId);

  const chartData = useMemo(() => {
    if (!data) return [];
    // Filter out roxzone, sort by segment order
    const segments = data
      .filter((d) => d.segmentType !== "roxzone")
      .sort((a, b) => {
        // Natural sort: Run 1, SkiErg, Run 2, Sled Push, ...
        const ORDER = [
          "Run 1", "SkiErg", "Run 2", "Sled Push", "Run 3", "Sled Pull",
          "Run 4", "Broad Jump Burpees", "Run 5", "Rowing", "Run 6",
          "Farmers Carry", "Run 7", "Sandbag Lunges", "Run 8", "Wall Balls",
        ];
        return ORDER.indexOf(a.segmentLabel) - ORDER.indexOf(b.segmentLabel);
      });

    return segments.map((seg) => {
      const userTime = userOverlay?.find(
        (u) => u.segmentLabel === seg.segmentLabel,
      )?.timeSeconds;

      return {
        label: seg.segmentLabel.replace("Broad Jump Burpees", "BBJ"),
        avgSeconds: Math.round(seg.meanSeconds),
        type: seg.segmentType,
        userSeconds: userTime ?? null,
      };
    });
  }, [data, userOverlay]);

  if (isLoading) {
    return <PaceProfileSkeleton />;
  }

  if (!data || data.length === 0) {
    return (
      <Card className="gradient-border">
        <CardContent className="flex flex-col items-center gap-3 py-10 bg-mesh rounded-xl">
          <p className="text-sm text-muted-foreground">
            Not enough data in this division yet — insights will unlock as we ingest more events.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="gradient-border overflow-visible">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          Race Pace Profile
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Average time per segment across the race
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 24, left: 0 }}>
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
                labelStyle={{ color: "rgba(255,255,255,0.7)" }}
              />
              <Line
                type="monotone"
                dataKey="avgSeconds"
                stroke="oklch(0.85 0.20 130)"
                strokeWidth={2}
                dot={({ cx, cy, payload }: Record<string, unknown>) => {
                  const x = Number(cx ?? 0);
                  const y = Number(cy ?? 0);
                  const p = payload as { type?: string } | undefined;
                  const color = p?.type === "run" ? "#60a5fa" : "#fb923c";
                  return (
                    <circle
                      key={`${x}-${y}`}
                      cx={x}
                      cy={y}
                      r={4}
                      fill={color}
                      stroke="none"
                    />
                  );
                }}
                name="Field Average"
              />
              {userOverlay && (
                <Line
                  type="monotone"
                  dataKey="userSeconds"
                  stroke="#34d399"
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  dot={{ r: 3, fill: "#34d399" }}
                  name="Your Times"
                  connectNulls
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex items-center gap-4 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-blue-400" /> Runs
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-orange-400" /> Stations
          </span>
          {userOverlay && (
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-400" /> Your Times
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PaceProfileSkeleton() {
  return (
    <Card className="gradient-border">
      <CardHeader className="pb-2">
        <div className="h-4 w-36 rounded bg-white/[0.04] animate-pulse" />
        <div className="h-3 w-56 rounded bg-white/[0.04] animate-pulse mt-1" />
      </CardHeader>
      <CardContent>
        <div className="h-64 w-full rounded bg-white/[0.04] animate-pulse" />
      </CardContent>
    </Card>
  );
}
