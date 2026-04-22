"use client";

import { useState, useCallback } from "react";
import {
  Plus,
  Footprints,
  Dumbbell,
  RotateCcw,
  Timer,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DivisionPicker } from "@/components/shared/division-picker";
import {
  DIVISIONS,
  STATION_ORDER,
  type DivisionKey,
} from "@/lib/hyrox-data";
import { SegmentList } from "./segment-list";
import {
  buildFullRaceSegments,
  buildHalfRaceSegments,
  createRunSegment,
  createStationSegment,
} from "./race-segments";
import type { RaceSegment, RaceTemplate } from "./types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TimerSetupProps {
  onStart: (segments: RaceSegment[], divisionKey: DivisionKey, template: RaceTemplate) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TimerSetup({ onStart }: TimerSetupProps) {
  const [divisionKey, setDivisionKey] = useState<DivisionKey>("women_open");
  const [template, setTemplate] = useState<RaceTemplate>("full");
  const [segments, setSegments] = useState<RaceSegment[]>(() =>
    buildFullRaceSegments("women_open"),
  );
  const [showAddMenu, setShowAddMenu] = useState(false);

  // Rebuild segments when template or division changes
  const applyTemplate = useCallback(
    (t: RaceTemplate, dk: DivisionKey) => {
      setTemplate(t);
      if (t === "full") {
        setSegments(buildFullRaceSegments(dk));
      } else if (t === "half") {
        setSegments(buildHalfRaceSegments(dk));
      }
      // "custom" keeps current segments
    },
    [],
  );

  const handleDivisionChange = useCallback(
    (dk: DivisionKey) => {
      setDivisionKey(dk);
      if (template !== "custom") {
        applyTemplate(template, dk);
      }
    },
    [template, applyTemplate],
  );

  const handleTemplateChange = useCallback(
    (t: RaceTemplate) => {
      applyTemplate(t, divisionKey);
    },
    [divisionKey, applyTemplate],
  );

  const handleSegmentsChange = useCallback(
    (newSegments: RaceSegment[]) => {
      setSegments(newSegments);
      // If user modifies segments while on a preset, switch to custom
      if (template !== "custom") {
        setTemplate("custom");
      }
    },
    [template],
  );

  const addRun = useCallback(() => {
    setSegments((prev) => [...prev, createRunSegment()]);
    setShowAddMenu(false);
    if (template !== "custom") setTemplate("custom");
  }, [template]);

  const addStation = useCallback(
    (name: string) => {
      const div = DIVISIONS[divisionKey];
      const stationSpec = div.stations.find((s) => s.name === name);
      setSegments((prev) => [
        ...prev,
        {
          ...createStationSegment(name),
          distance: stationSpec?.distance,
          reps: stationSpec?.reps,
          weightLabel: stationSpec?.weightLabel,
        },
      ]);
      setShowAddMenu(false);
      if (template !== "custom") setTemplate("custom");
    },
    [divisionKey, template],
  );

  const resetToDefault = useCallback(() => {
    applyTemplate("full", divisionKey);
  }, [divisionKey, applyTemplate]);

  const totalSegments = segments.length;
  const runCount = segments.filter((s) => s.segmentType === "run").length;
  const stationCount = segments.filter((s) => s.segmentType === "station").length;

  return (
    <div className="flex flex-col gap-4 pb-8">
      {/* Header */}
      <div className="text-center pt-2">
        <div className="flex items-center justify-center gap-2 mb-1">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <Timer className="h-5 w-5 text-primary" />
          </div>
        </div>
        <h1 className="text-lg font-bold">Practice Race Timer</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Time each segment of your practice HYROX race
        </p>
      </div>

      {/* Division selector */}
      <Card>
        <CardContent className="py-3">
          <DivisionPicker
            value={divisionKey}
            onChange={handleDivisionChange}
            label="Division (for weight context)"
          />
        </CardContent>
      </Card>

      {/* Template selector */}
      <div className="flex rounded-lg bg-white/[0.03] p-1 gap-1">
        {(
          [
            { key: "full", label: "Full Race" },
            { key: "half", label: "Half Race" },
            { key: "custom", label: "Custom" },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => handleTemplateChange(key)}
            className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition-all duration-200 ${
              template === key
                ? "bg-primary/15 text-primary glow-primary-sm"
                : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Segment summary */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span>
          {totalSegments} segments ({runCount} runs, {stationCount} stations)
        </span>
        {template === "custom" && (
          <button
            onClick={resetToDefault}
            className="flex items-center gap-1 text-primary hover:text-primary/80 transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
        )}
      </div>

      {/* Segment list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold">Race Order</CardTitle>
        </CardHeader>
        <CardContent>
          <SegmentList segments={segments} onChange={handleSegmentsChange} />

          {/* Add segment buttons */}
          <div className="mt-3 relative">
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs gap-1.5"
              onClick={() => setShowAddMenu(!showAddMenu)}
            >
              <Plus className="h-3.5 w-3.5" />
              Add Segment
            </Button>

            {showAddMenu && (
              <div className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-white/[0.08] bg-background shadow-xl z-10 max-h-64 overflow-y-auto">
                <button
                  onClick={addRun}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-xs hover:bg-white/[0.04] transition-colors border-b border-white/[0.06]"
                >
                  <Footprints className="h-3.5 w-3.5 text-blue-400" />
                  <span className="font-medium">Run</span>
                  <span className="text-muted-foreground ml-auto">1 km</span>
                </button>
                {STATION_ORDER.map((station) => (
                  <button
                    key={station}
                    onClick={() => addStation(station)}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-xs hover:bg-white/[0.04] transition-colors"
                  >
                    <Dumbbell className="h-3.5 w-3.5 text-orange-400" />
                    <span className="font-medium">{station}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Start button */}
      <button
        onClick={() => onStart(segments, divisionKey, template)}
        disabled={segments.length === 0}
        className="w-full rounded-2xl bg-primary py-5 text-lg font-bold text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90 active:scale-[0.98] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        START RACE
      </button>
    </div>
  );
}
