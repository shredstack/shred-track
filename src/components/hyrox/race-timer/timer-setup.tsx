"use client";

import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import {
  Plus,
  Footprints,
  Dumbbell,
  RotateCcw,
  Timer,
  Info,
  Bookmark,
  Save,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DivisionPicker } from "@/components/shared/division-picker";
import {
  DIVISIONS,
  STATION_ORDER,
  parseDistanceToMeters,
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
import type { RaceTemplateSegment } from "@/db/schema";
import {
  useRaceTemplates,
  useCreateRaceTemplate,
  useDeleteRaceTemplate,
  type RaceTemplate as SavedRaceTemplate,
} from "@/hooks/useRaceTemplates";

// ---------------------------------------------------------------------------
// Roxzone toggle persistence
// ---------------------------------------------------------------------------

// Per spec §3.1 / open question #1: localStorage for v1, revisit when we
// add cross-device (Watch) support.
const ROXZONE_PREF_KEY = "shredtrack.timer.simulateRoxzone";

function loadRoxzonePref(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ROXZONE_PREF_KEY) === "true";
  } catch {
    return false;
  }
}

function saveRoxzonePref(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ROXZONE_PREF_KEY, value ? "true" : "false");
  } catch {
    // noop
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TimerSetupProps {
  onStart: (segments: RaceSegment[], divisionKey: DivisionKey, template: RaceTemplate) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// Cheap monotonically-increasing ID generator for segments loaded from
// a saved template. Mirrors race-segments.ts's `uid()` so React keys
// stay stable across re-renders even after loading the same template
// twice in a row.
let nextLoadedSegmentId = 1;
function loadedSegmentId(): string {
  return `seg-loaded-${nextLoadedSegmentId++}-${Date.now()}`;
}

export function TimerSetup({ onStart }: TimerSetupProps) {
  const [divisionKey, setDivisionKey] = useState<DivisionKey>("women_open");
  const [template, setTemplate] = useState<RaceTemplate>("full");
  // Default false; hydrate from localStorage in an effect to avoid SSR mismatch.
  const [simulateRoxzone, setSimulateRoxzone] = useState<boolean>(false);
  const [showRoxzoneInfo, setShowRoxzoneInfo] = useState<boolean>(false);
  const [segments, setSegments] = useState<RaceSegment[]>(() =>
    buildFullRaceSegments("women_open"),
  );
  const [showAddMenu, setShowAddMenu] = useState(false);

  // Saved-template UI state.
  const templatesQuery = useRaceTemplates();
  const createTemplate = useCreateRaceTemplate();
  const deleteTemplate = useDeleteRaceTemplate();
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");

  // Hydrate persisted Roxzone preference on mount and rebuild segments
  // for the current preset. The deps are intentionally empty — we only
  // want to run this once at mount.
  useEffect(() => {
    const saved = loadRoxzonePref();
    if (saved) {
      setSimulateRoxzone(true);
      setSegments(buildFullRaceSegments("women_open", { simulateRoxzone: true }));
    }
  }, []);

  // Rebuild segments when template or division changes
  const applyTemplate = useCallback(
    (t: RaceTemplate, dk: DivisionKey, opts?: { simulateRoxzone?: boolean }) => {
      setTemplate(t);
      const roxzone = opts?.simulateRoxzone ?? simulateRoxzone;
      if (t === "full") {
        setSegments(buildFullRaceSegments(dk, { simulateRoxzone: roxzone }));
      } else if (t === "half") {
        setSegments(buildHalfRaceSegments(dk, { simulateRoxzone: roxzone }));
      }
      // "custom" keeps current segments
    },
    [simulateRoxzone],
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

  const handleRoxzoneToggle = useCallback(
    (next: boolean) => {
      setSimulateRoxzone(next);
      saveRoxzonePref(next);
      // Only rebuild for presets — custom keeps the user's manual list.
      if (template === "full" || template === "half") {
        applyTemplate(template, divisionKey, { simulateRoxzone: next });
      }
    },
    [template, divisionKey, applyTemplate],
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
          distanceMeters: parseDistanceToMeters(stationSpec?.distance) ?? undefined,
          reps: stationSpec?.reps,
          weightKg: stationSpec?.weightKg,
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

  const handleLoadTemplate = useCallback(
    (saved: SavedRaceTemplate) => {
      if (saved.divisionKey) {
        setDivisionKey(saved.divisionKey as DivisionKey);
      }
      setSimulateRoxzone(saved.simulateRoxzone);
      // Regenerate IDs so React keys stay stable across loads.
      setSegments(
        saved.segments.map((s) => ({ ...s, id: loadedSegmentId() })),
      );
      setTemplate("custom");
      setShowAddMenu(false);
      toast.success(`Loaded "${saved.name}"`);
    },
    [],
  );

  const handleOpenSaveDialog = useCallback(() => {
    setTemplateName("");
    setSaveDialogOpen(true);
  }, []);

  const handleSaveTemplate = useCallback(async () => {
    const name = templateName.trim();
    if (!name) {
      toast.error("Give your template a name first");
      return;
    }
    try {
      // Strip the volatile `id` field — the server side does this too,
      // but stripping client-side keeps the payload tight.
      const stored: RaceTemplateSegment[] = segments.map((s) => ({
        segmentType: s.segmentType,
        label: s.label,
        ...(s.segmentSubtype ? { segmentSubtype: s.segmentSubtype } : {}),
        ...(s.distance ? { distance: s.distance } : {}),
        ...(typeof s.distanceMeters === "number"
          ? { distanceMeters: s.distanceMeters }
          : {}),
        ...(typeof s.reps === "number" ? { reps: s.reps } : {}),
        ...(typeof s.weightKg === "number" ? { weightKg: s.weightKg } : {}),
        ...(s.weightLabel ? { weightLabel: s.weightLabel } : {}),
      }));
      await createTemplate.mutateAsync({
        name,
        divisionKey,
        simulateRoxzone,
        segments: stored,
      });
      setSaveDialogOpen(false);
      toast.success(`Saved "${name}"`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't save template";
      toast.error(message);
    }
  }, [templateName, segments, divisionKey, simulateRoxzone, createTemplate]);

  const handleDeleteTemplate = useCallback(
    async (id: string, name: string) => {
      try {
        await deleteTemplate.mutateAsync(id);
        toast.success(`Deleted "${name}"`);
      } catch {
        toast.error("Couldn't delete template");
      }
    },
    [deleteTemplate],
  );

  const savedTemplates = templatesQuery.data ?? [];

  const totalSegments = segments.length;
  const runCount = segments.filter((s) => s.segmentType === "run").length;
  const stationCount = segments.filter((s) => s.segmentType === "station").length;

  const roxzoneDisabled = template === "custom";

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

      {/* Saved templates — only render the row when there's something
          to show or when the user is on Custom and could save one. */}
      {(savedTemplates.length > 0 || template === "custom") && (
        <Card>
          <CardContent className="py-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Bookmark className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium">My templates</span>
              </div>
              {template === "custom" && segments.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 h-7 text-[11px]"
                  onClick={handleOpenSaveDialog}
                >
                  <Save className="h-3 w-3" />
                  Save current
                </Button>
              )}
            </div>

            {savedTemplates.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">
                Customize the segments below, then tap Save current to reuse
                this layout later.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {savedTemplates.map((tpl) => (
                  <div
                    key={tpl.id}
                    className="group inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.03] pl-3 pr-1 py-1 text-[11px] gap-1 hover:bg-white/[0.06] transition-colors"
                  >
                    <button
                      onClick={() => handleLoadTemplate(tpl)}
                      className="font-medium hover:text-primary transition-colors"
                    >
                      {tpl.name}
                    </button>
                    <button
                      onClick={() => handleDeleteTemplate(tpl.id, tpl.name)}
                      aria-label={`Delete template ${tpl.name}`}
                      className="ml-0.5 inline-flex items-center justify-center h-5 w-5 rounded-full text-muted-foreground hover:bg-red-500/15 hover:text-red-300 transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Roxzone toggle */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium">Simulate Roxzone</span>
                <button
                  type="button"
                  onClick={() => setShowRoxzoneInfo((v) => !v)}
                  aria-label="What is the Roxzone?"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {roxzoneDisabled
                  ? "Available for Full or Half templates only"
                  : "Adds a 100m run between each station and the next run (~800m total)"}
              </p>
            </div>
            <Switch
              checked={simulateRoxzone}
              onCheckedChange={handleRoxzoneToggle}
              disabled={roxzoneDisabled}
              aria-label="Simulate Roxzone"
            />
          </div>

          {showRoxzoneInfo && (
            <div className="mt-3 rounded-lg bg-white/[0.04] border border-white/[0.06] px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              On race day you cover ~700–800m of extra running through the
              transition zone between stations. Turning this on inserts a
              100m run after each station so your practice finish times
              are honest, and you can train the mental gear-shift at every
              transition.
            </div>
          )}
        </CardContent>
      </Card>

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

      {/* Segment list. overflow-visible so the "Add Segment" dropdown
          isn't clipped by Card's default overflow-hidden — the menu
          opens downward via absolute positioning. */}
      <Card className="overflow-visible">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold">Race Order</CardTitle>
          {template === "custom" && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Tap any distance, reps, or weight to edit. The system uses
              your custom values for pace, splits, and PR comparisons.
            </p>
          )}
        </CardHeader>
        <CardContent>
          <SegmentList
            segments={segments}
            onChange={handleSegmentsChange}
            editable={template === "custom"}
            divisionKey={divisionKey}
          />

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
              <div
                // Callback ref: when the menu mounts, scroll its bottom
                // into view so the last items (e.g. Wall Balls) are
                // reachable on a phone where the button sits near the
                // viewport bottom. Smooth scroll keeps it feeling native.
                ref={(el) => {
                  if (el) {
                    el.scrollIntoView({ behavior: "smooth", block: "end" });
                  }
                }}
                className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-white/[0.08] bg-background shadow-xl z-10 max-h-64 overflow-y-auto"
              >
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

      {/* Save-template dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save race template</DialogTitle>
            <DialogDescription>
              Saves the current segments, division, and Roxzone setting so
              you can reuse this layout with one tap.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <label htmlFor="template-name" className="text-xs font-medium">
              Name
            </label>
            <Input
              id="template-name"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="e.g. 200m runs, no sled"
              maxLength={60}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSaveTemplate();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSaveDialogOpen(false)}
              disabled={createTemplate.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveTemplate}
              disabled={createTemplate.isPending || !templateName.trim()}
            >
              {createTemplate.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
