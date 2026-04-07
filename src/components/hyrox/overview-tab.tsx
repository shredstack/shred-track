"use client";

import { useState } from "react";
import {
  Info,
  ArrowRight,
  Activity,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OverviewTab() {
  const [useImperial, setUseImperial] = useState(false);
  const [activeDivision, setActiveDivision] = useState<DivisionKey>("women_open");

  const division = DIVISIONS[activeDivision];
  const refs = REFERENCE_TIMES[activeDivision];

  const convertWeight = (kg: number): string => {
    if (useImperial) return `${kgToLbs(kg)} lbs`;
    return `${kg} kg`;
  };

  const convertDistance = (distStr: string): string => {
    if (!useImperial) return distStr;
    const m = parseInt(distStr);
    if (isNaN(m)) return distStr;
    if (m >= 1000) return `${(m * 3.28084 / 5280).toFixed(2)} mi`;
    return `${Math.round(m * 3.28084)} ft`;
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Race format explainer */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Info className="h-4 w-4" />
            What is HYROX?
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            HYROX is a global fitness race combining running and functional
            workout stations. Every participant completes the same format:
          </p>
          <p className="font-medium text-foreground">
            8 x 1 km runs, each followed by a functional workout station.
          </p>
          <p>
            Total distance: 8 km running + 8 stations. The clock runs
            continuously from start to finish. Divisions differ by the weights
            used at each station.
          </p>
        </CardContent>
      </Card>

      {/* Station order diagram */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Race Flow</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-0">
            {STATION_ORDER.map((station, i) => (
              <div key={station}>
                {/* Run segment */}
                <div className="flex items-center gap-2 py-1.5">
                  <div className="flex h-6 w-6 items-center justify-center rounded bg-blue-500/10">
                    <Activity className="h-3 w-3 text-blue-400" />
                  </div>
                  <span className="text-xs text-blue-400 font-medium">
                    Run {i + 1} — 1 km
                  </span>
                </div>
                {/* Connector */}
                <div className="ml-3 h-3 border-l border-dashed border-muted-foreground/30" />
                {/* Station */}
                <div className="flex items-center gap-2 py-1.5">
                  <div className="flex h-6 w-6 items-center justify-center rounded bg-orange-500/10">
                    <span className="text-[10px] font-bold text-orange-400">{i + 1}</span>
                  </div>
                  <span className="text-xs font-medium">{station}</span>
                </div>
                {i < STATION_ORDER.length - 1 && (
                  <div className="ml-3 h-3 border-l border-dashed border-muted-foreground/30" />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Unit toggle */}
      <div className="flex items-center justify-between rounded-lg bg-muted/30 px-4 py-3">
        <Label className="text-sm">Show in imperial units</Label>
        <Switch
          checked={useImperial}
          onCheckedChange={(val) => setUseImperial(val as boolean)}
        />
      </div>

      {/* Division selector */}
      <div className="flex gap-1.5">
        {DIVISION_KEYS.map((d) => (
          <button
            key={d}
            onClick={() => setActiveDivision(d)}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
              activeDivision === d
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {DIVISIONS[d].label}
          </button>
        ))}
      </div>

      {/* Division table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{division.label} — Station Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="pb-2 pr-3 text-left font-medium">Station</th>
                  <th className="pb-2 pr-3 text-left font-medium">Spec</th>
                  <th className="pb-2 pr-1 text-right font-medium">Pro</th>
                  <th className="pb-2 pr-1 text-right font-medium">Avg</th>
                  <th className="pb-2 text-right font-medium">Slow</th>
                </tr>
              </thead>
              <tbody>
                {division.stations.map((s) => {
                  const ref = refs[s.name as keyof typeof refs];
                  const spec = s.distance
                    ? `${convertDistance(s.distance)}${s.weightLabel ? ` @ ${useImperial && s.weightKg ? convertWeight(s.weightKg) : s.weightLabel}` : ""}`
                    : `${s.reps} reps${s.weightLabel ? ` @ ${useImperial && s.weightKg ? convertWeight(s.weightKg) : s.weightLabel}` : ""}`;

                  return (
                    <tr key={s.name} className="border-b border-border/50 last:border-0">
                      <td className="py-2 pr-3 font-medium">{s.shortName}</td>
                      <td className="py-2 pr-3 text-muted-foreground font-mono">{spec}</td>
                      <td className="py-2 pr-1 text-right font-mono text-green-400">
                        {ref ? formatTime(ref[0]) : "—"}
                      </td>
                      <td className="py-2 pr-1 text-right font-mono">
                        {ref ? formatTime(ref[1]) : "—"}
                      </td>
                      <td className="py-2 text-right font-mono text-muted-foreground">
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
