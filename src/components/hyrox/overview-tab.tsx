"use client";

import { useState } from "react";
import {
  Info,
  Activity,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  DIVISIONS,
  DIVISION_KEYS,
  STATION_ORDER,
  REFERENCE_TIMES,
  formatTime,
  kgToLbs,
  type DivisionKey,
} from "@/lib/hyrox-data";

export function OverviewTab() {
  const [useMixed, setUseMixed] = useState(false);
  const [activeDivision, setActiveDivision] = useState<DivisionKey>("women_open");

  const division = DIVISIONS[activeDivision];
  const refs = REFERENCE_TIMES[activeDivision];

  const convertWeight = (kg: number): string => {
    if (useMixed) return `${kgToLbs(kg)} lbs`;
    return `${kg} kg`;
  };

  const convertDistance = (distStr: string): string => {
    return distStr;
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Race format explainer */}
      <Card className="gradient-border overflow-visible">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-500/10">
              <Info className="h-3.5 w-3.5 text-blue-400" />
            </div>
            What is HYROX?
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5 text-sm text-muted-foreground leading-relaxed">
          <p>
            HYROX is a global fitness race combining running and functional
            workout stations. Every participant completes the same format:
          </p>
          <p className="font-semibold text-foreground">
            8 x 1 km runs, each followed by a functional workout station.
          </p>
          <p>
            Total distance: 8 km running + 8 stations. The clock runs
            continuously from start to finish.
          </p>
        </CardContent>
      </Card>

      {/* Station order diagram */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold">Race Flow</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-0">
            {STATION_ORDER.map((station, i) => (
              <div key={station}>
                <div className="flex items-center gap-2.5 py-1.5">
                  <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-500/10">
                    <Activity className="h-3 w-3 text-blue-400" />
                  </div>
                  <span className="text-xs text-blue-400 font-medium">
                    Run {i + 1} — 1 km
                  </span>
                </div>
                <div className="ml-3 h-3 border-l border-dashed border-white/[0.08]" />
                <div className="flex items-center gap-2.5 py-1.5">
                  <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-orange-500/10">
                    <span className="text-[10px] font-bold text-orange-400">{i + 1}</span>
                  </div>
                  <span className="text-xs font-medium">{station}</span>
                </div>
                {i < STATION_ORDER.length - 1 && (
                  <div className="ml-3 h-3 border-l border-dashed border-white/[0.08]" />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Unit toggle */}
      <div className="flex items-center justify-between rounded-xl bg-white/[0.03] border border-white/[0.06] px-4 py-3">
        <Label className="text-sm">Show in mixed units (Lbs/M)</Label>
        <Switch
          checked={useMixed}
          onCheckedChange={(val) => setUseMixed(val as boolean)}
        />
      </div>

      {/* Division selector */}
      <div className="flex gap-1.5">
        {DIVISION_KEYS.map((d) => (
          <button
            key={d}
            onClick={() => setActiveDivision(d)}
            className={`flex-1 rounded-lg px-2 py-2 text-xs font-medium transition-all duration-200 ${
              activeDivision === d
                ? "bg-primary/15 text-primary glow-primary-sm"
                : "bg-white/[0.03] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
            }`}
          >
            {DIVISIONS[d].label}
          </button>
        ))}
      </div>

      {/* Division table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold">{division.label} — Station Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06] text-muted-foreground">
                  <th className="pb-2.5 pr-3 text-left font-medium">Station</th>
                  <th className="pb-2.5 pr-3 text-left font-medium">Spec</th>
                  <th className="pb-2.5 pr-1 text-right font-medium">Pro</th>
                  <th className="pb-2.5 pr-1 text-right font-medium">Avg</th>
                  <th className="pb-2.5 text-right font-medium">Slow</th>
                </tr>
              </thead>
              <tbody>
                {division.stations.map((s) => {
                  const ref = refs[s.name as keyof typeof refs];
                  const spec = s.distance
                    ? `${convertDistance(s.distance)}${s.weightLabel ? ` @ ${useMixed && s.weightKg ? convertWeight(s.weightKg) : s.weightLabel}` : ""}`
                    : `${s.reps} reps${s.weightLabel ? ` @ ${useMixed && s.weightKg ? convertWeight(s.weightKg) : s.weightLabel}` : ""}`;

                  return (
                    <tr key={s.name} className="border-b border-white/[0.04] last:border-0">
                      <td className="py-2.5 pr-3 font-medium">{s.shortName}</td>
                      <td className="py-2.5 pr-3 text-muted-foreground font-mono">{spec}</td>
                      <td className="py-2.5 pr-1 text-right font-mono text-emerald-400">
                        {ref ? formatTime(ref[0]) : "—"}
                      </td>
                      <td className="py-2.5 pr-1 text-right font-mono">
                        {ref ? formatTime(ref[1]) : "—"}
                      </td>
                      <td className="py-2.5 text-right font-mono text-muted-foreground">
                        {ref ? formatTime(ref[2]) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
