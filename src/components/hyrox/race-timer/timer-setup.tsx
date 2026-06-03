"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
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
  Hourglass,
  Users,
  Star,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  useCloneRaceTemplate,
  type RaceTemplate as SavedRaceTemplate,
  type GymRaceTemplate,
} from "@/hooks/useRaceTemplates";
import { useGymContext } from "@/hooks/useGymContext";
import {
  useCountdownPreference,
  type CountdownSeconds,
} from "@/hooks/useCountdownPreference";

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
  onStart: (
    segments: RaceSegment[],
    divisionKey: DivisionKey,
    template: RaceTemplate,
    countdownSeconds: CountdownSeconds,
  ) => void;
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

  // Pre-race countdown preference (shared via localStorage with the
  // active screen and the watch-bridge relay).
  const { seconds: countdownSeconds, setSeconds: setCountdownSeconds, options: countdownOptions } =
    useCountdownPreference();

  // When the user loads a template that has its own countdownSeconds
  // baked in, override the global preference for *this race only*. The
  // override is cleared when the user explicitly taps the countdown
  // picker (their tap = "use this from now on", which also updates the
  // global pref). Holds the source template's name so we can hint at
  // it under the picker.
  const [countdownOverride, setCountdownOverride] = useState<{
    seconds: CountdownSeconds;
    sourceName: string;
  } | null>(null);
  const effectiveCountdown: CountdownSeconds =
    countdownOverride?.seconds ?? countdownSeconds;

  // Saved-template UI state.
  const templatesQuery = useRaceTemplates();
  const createTemplate = useCreateRaceTemplate();
  const deleteTemplate = useDeleteRaceTemplate();
  const cloneTemplate = useCloneRaceTemplate();
  const gymContext = useGymContext();
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [shareWithGym, setShareWithGym] = useState(false);
  const [shareCommunityId, setShareCommunityId] = useState<string | null>(null);
  const [templatesTab, setTemplatesTab] = useState<"mine" | "gym">("mine");
  // Per-template countdown chosen in the save dialog. Defaults to the
  // current effective value when the dialog opens.
  const [dialogCountdown, setDialogCountdown] =
    useState<CountdownSeconds>(10);

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
      // Switching presets clears any per-template countdown override —
      // we're no longer on the saved template that set it.
      setCountdownOverride(null);
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
      // Editing segments breaks the link with the loaded template, so
      // its countdown shouldn't keep applying either.
      setCountdownOverride(null);
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
    setCountdownOverride(null);
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
      setCountdownOverride(null);
    },
    [divisionKey, template],
  );

  const resetToDefault = useCallback(() => {
    applyTemplate("full", divisionKey);
    setCountdownOverride(null);
  }, [divisionKey, applyTemplate]);

  const handleLoadTemplate = useCallback(
    (saved: SavedRaceTemplate, opts?: { toastMessage?: string }) => {
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
      // Apply the template's countdown for this race only. Clear any
      // prior override when the template has no value of its own so we
      // fall back to the global preference.
      if (
        saved.countdownSeconds !== null &&
        saved.countdownSeconds !== undefined &&
        (countdownOptions as readonly number[]).includes(saved.countdownSeconds)
      ) {
        setCountdownOverride({
          seconds: saved.countdownSeconds as CountdownSeconds,
          sourceName: saved.name,
        });
      } else {
        setCountdownOverride(null);
      }
      toast.success(opts?.toastMessage ?? `Loaded "${saved.name}"`);
    },
    [countdownOptions],
  );

  // Eligible gyms for sharing/picking — active memberships only.
  // Sorted oldest-first so the default selection is the user's first gym
  // (rare multi-gym case: that's a sensible default the user can override).
  const shareableGyms = useMemo(() => {
    const all = gymContext.data?.memberships ?? [];
    return all
      .filter((m) => m.isActive)
      .slice()
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  }, [gymContext.data]);

  const handleOpenSaveDialog = useCallback(() => {
    setTemplateName("");
    setShareWithGym(false);
    setShareCommunityId(shareableGyms[0]?.communityId ?? null);
    setDialogCountdown(effectiveCountdown);
    setSaveDialogOpen(true);
  }, [shareableGyms, effectiveCountdown]);

  const handleCloneGymTemplate = useCallback(
    async (gymTpl: GymRaceTemplate) => {
      try {
        const clone = await cloneTemplate.mutateAsync(gymTpl.id);
        // Move to Mine so the user sees the clone land in their list,
        // then load it into the timer for instant use.
        setTemplatesTab("mine");
        handleLoadTemplate(clone, {
          toastMessage: `Saved "${gymTpl.name}" to your templates`,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Couldn't save that template";
        toast.error(message);
      }
    },
    [cloneTemplate, handleLoadTemplate],
  );

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
      const communityId = shareWithGym ? shareCommunityId : null;
      await createTemplate.mutateAsync({
        name,
        divisionKey,
        simulateRoxzone,
        countdownSeconds: dialogCountdown,
        segments: stored,
        communityId,
      });
      setSaveDialogOpen(false);
      toast.success(
        communityId ? `Saved "${name}" and shared with gym` : `Saved "${name}"`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't save template";
      toast.error(message);
    }
  }, [
    templateName,
    segments,
    divisionKey,
    simulateRoxzone,
    dialogCountdown,
    createTemplate,
    shareWithGym,
    shareCommunityId,
  ]);

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

  const savedTemplates = templatesQuery.data?.mine ?? [];
  const gymTemplates = templatesQuery.data?.gym ?? [];
  const hasShareableGym = shareableGyms.length > 0;

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

      {/* Saved templates — Mine + Gym tabs. The card renders whenever the
          user has anything to pick from or is on Custom (so the Save
          button is reachable). Users with no gym membership only see
          Mine; the Gym tab is hidden entirely. */}
      {(savedTemplates.length > 0 ||
        gymTemplates.length > 0 ||
        template === "custom") && (
        <Card>
          <CardContent className="py-3 flex flex-col gap-2">
            <Tabs
              value={templatesTab}
              onValueChange={(v) => setTemplatesTab(v as "mine" | "gym")}
            >
              <div className="flex items-center justify-between gap-2">
                <TabsList className="h-7">
                  <TabsTrigger value="mine" className="text-[11px] px-2.5">
                    <Bookmark className="h-3 w-3" />
                    Mine
                  </TabsTrigger>
                  {hasShareableGym && (
                    <TabsTrigger value="gym" className="text-[11px] px-2.5">
                      <Users className="h-3 w-3" />
                      Gym{gymTemplates.length > 0 ? ` (${gymTemplates.length})` : ""}
                    </TabsTrigger>
                  )}
                </TabsList>
                {templatesTab === "mine" &&
                  template === "custom" &&
                  segments.length > 0 && (
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

              <TabsContent value="mine" className="mt-2">
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
                          className="font-medium hover:text-primary transition-colors flex items-center gap-1"
                        >
                          {tpl.name}
                          {tpl.communityId && (
                            <Users
                              className="h-2.5 w-2.5 text-primary"
                              aria-label="Shared with gym"
                            />
                          )}
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
              </TabsContent>

              {hasShareableGym && (
                <TabsContent value="gym" className="mt-2">
                  {gymTemplates.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground">
                      No shared templates yet. Toggle “Share with gym” when you
                      save one and it’ll show up here for everyone.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {gymTemplates.map((tpl) => (
                        <button
                          key={tpl.id}
                          onClick={() => handleCloneGymTemplate(tpl)}
                          disabled={cloneTemplate.isPending}
                          className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-left hover:bg-white/[0.06] transition-colors disabled:opacity-50"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              {tpl.authorIsCoach && (
                                <Star
                                  className="h-3 w-3 text-amber-300 shrink-0"
                                  aria-label="Coach"
                                />
                              )}
                              <span className="text-xs font-medium truncate">
                                {tpl.name}
                              </span>
                            </div>
                            <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                              {tpl.authorName.split(" ")[0]}
                              {tpl.authorIsCoach ? " · Coach" : ""}
                              {" · "}
                              {tpl.segments.length} segments
                              {tpl.simulateRoxzone ? " · Roxzone" : ""}
                            </p>
                          </div>
                          <span className="text-[10px] text-primary shrink-0">
                            {cloneTemplate.isPending ? "Saving…" : "Use"}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </TabsContent>
              )}
            </Tabs>
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

      {/* Pre-race countdown */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <Hourglass className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-medium">Pre-race countdown</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {countdownOverride
                    ? `Using "${countdownOverride.sourceName}" template's setting — tap to change`
                    : "Time to stash your phone and get on the line"}
                </p>
              </div>
            </div>
            <div className="flex rounded-md bg-white/[0.03] p-0.5 gap-0.5">
              {countdownOptions.map((opt) => (
                <button
                  key={opt}
                  onClick={() => {
                    // Tapping the picker = "use this for this race AND
                    // make it my new default". Clearing the override
                    // makes the global preference visible again.
                    setCountdownOverride(null);
                    setCountdownSeconds(opt as CountdownSeconds);
                  }}
                  className={`min-w-[34px] rounded px-2 py-1 text-[11px] font-medium transition-all duration-150 ${
                    effectiveCountdown === opt
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-white/[0.06]"
                  }`}
                  aria-pressed={effectiveCountdown === opt}
                  aria-label={opt === 0 ? "No countdown" : `${opt} second countdown`}
                >
                  {opt === 0 ? "Off" : `${opt}s`}
                </button>
              ))}
            </div>
          </div>
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
        onClick={() => onStart(segments, divisionKey, template, effectiveCountdown)}
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
          <div className="flex flex-col gap-3">
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

            <div className="flex flex-col gap-2 rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Hourglass className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium">
                      Pre-race countdown
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Used on phone and watch when starting from this template.
                  </p>
                </div>
                <div className="flex rounded-md bg-white/[0.03] p-0.5 gap-0.5">
                  {countdownOptions.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setDialogCountdown(opt as CountdownSeconds)}
                      className={`min-w-[34px] rounded px-2 py-1 text-[11px] font-medium transition-all duration-150 ${
                        dialogCountdown === opt
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground hover:bg-white/[0.06]"
                      }`}
                      aria-pressed={dialogCountdown === opt}
                      aria-label={
                        opt === 0 ? "No countdown" : `${opt} second countdown`
                      }
                    >
                      {opt === 0 ? "Off" : `${opt}s`}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {hasShareableGym && (
              <div className="flex flex-col gap-2 rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium">
                        Share with gym
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Other members can save a copy to use on their phone.
                    </p>
                  </div>
                  <Switch
                    checked={shareWithGym}
                    onCheckedChange={setShareWithGym}
                    aria-label="Share with gym"
                  />
                </div>

                {/* Multi-gym picker — only shown when sharing AND the user
                    belongs to more than one gym. Defaults to their oldest
                    membership (set when the dialog opens). */}
                {shareWithGym && shareableGyms.length > 1 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {shareableGyms.map((m) => (
                      <button
                        key={m.communityId}
                        type="button"
                        onClick={() => setShareCommunityId(m.communityId)}
                        className={`rounded-full border px-3 py-1 text-[11px] transition-colors ${
                          shareCommunityId === m.communityId
                            ? "border-primary/40 bg-primary/15 text-primary"
                            : "border-white/[0.08] bg-white/[0.03] text-muted-foreground hover:bg-white/[0.06]"
                        }`}
                      >
                        {m.communityName}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
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
