"use client";

import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { TimerSetup } from "./timer-setup";
import { TimerActive } from "./timer-active";
import { TimerComplete } from "./timer-complete";
import { useRaceTimer } from "./use-race-timer";
import { buildFullRaceSegments } from "./race-segments";
import type { RaceSegment, RaceTemplate, PracticeRaceResult } from "./types";
import type { DivisionKey } from "@/lib/hyrox-data";
import { practiceRaceKeys } from "@/hooks/usePracticeRaces";
import { formatLongTime } from "@/lib/hyrox-data";

// ---------------------------------------------------------------------------
// Pending save queue for offline support
// ---------------------------------------------------------------------------

const PENDING_SAVE_KEY = "shredtrack-pending-race-saves";

interface PendingSave {
  result: PracticeRaceResult;
  title: string;
  notes: string;
  divisionKey: string;
  template: RaceTemplate;
}

function queuePendingSave(save: PendingSave): void {
  try {
    const existing = JSON.parse(
      localStorage.getItem(PENDING_SAVE_KEY) ?? "[]",
    ) as PendingSave[];
    existing.push(save);
    localStorage.setItem(PENDING_SAVE_KEY, JSON.stringify(existing));
  } catch {
    // noop
  }
}

// ---------------------------------------------------------------------------
// Auth check helper — lightweight, no server round-trip if cookie absent
// ---------------------------------------------------------------------------

function useIsLoggedIn(): boolean {
  const [loggedIn, setLoggedIn] = useState(false);
  useEffect(() => {
    // Check for auth session cookie presence
    const hasCookie =
      document.cookie.includes("sb-") ||
      document.cookie.includes("supabase-auth");
    setLoggedIn(hasCookie);
  }, []);
  return loggedIn;
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

type Screen = "setup" | "active" | "complete";

export function RaceTimerFlow() {
  const [screen, setScreen] = useState<Screen>("setup");
  const [divisionKey, setDivisionKey] = useState<DivisionKey>("women_open");
  const [template, setTemplate] = useState<RaceTemplate>("full");
  const [raceResult, setRaceResult] = useState<PracticeRaceResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [personalBests, setPersonalBests] = useState<string[]>([]);
  const [savedRaceId, setSavedRaceId] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const isLoggedIn = useIsLoggedIn();

  const defaultSegments = buildFullRaceSegments("women_open");
  const timer = useRaceTimer(defaultSegments);

  // Handle recovery prompt
  useEffect(() => {
    if (timer.recovered) {
      setScreen("active");
    }
  }, [timer.recovered]);

  const handleStart = useCallback(
    (segments: RaceSegment[], dk: DivisionKey, t: RaceTemplate) => {
      setDivisionKey(dk);
      setTemplate(t);
      setSaved(false);
      setPersonalBests([]);
      setSavedRaceId(null);
      timer.reset(segments);
      // Small delay to let reset propagate, then start
      requestAnimationFrame(() => {
        timer.start();
        setScreen("active");
      });
    },
    [timer],
  );

  const handleSplit = useCallback(() => {
    timer.split();
  }, [timer]);

  // Watch for race completion via the timer state
  useEffect(() => {
    if (timer.state.status === "complete" && screen === "active") {
      setScreen("complete");
    }
  }, [timer.state.status, screen]);

  const handleEndRace = useCallback(() => {
    const result = timer.endRace();
    setRaceResult(result);
    setScreen("complete");
  }, [timer]);

  const handleSave = useCallback(
    async (
      title: string,
      notes: string,
      raceType: "practice" | "actual",
    ) => {
      setIsSaving(true);
      try {
        const segments = timer.state.completedSegments;
        const totalMs = segments.reduce((sum, s) => sum + s.timeMs, 0);

        const payload = {
          title,
          notes,
          divisionKey,
          template,
          raceType,
          totalTimeSeconds: totalMs / 1000,
          startedAt: timer.state.raceStartedAt
            ? new Date(timer.state.raceStartedAt).toISOString()
            : new Date().toISOString(),
          completedAt: new Date().toISOString(),
          splits: segments.map((s) => ({
            segmentOrder: s.segmentOrder,
            segmentType: s.segmentType,
            segmentLabel: s.label,
            timeSeconds: s.timeMs / 1000,
          })),
        };

        const response = await fetch("/api/hyrox/practice-races", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          // If offline or server error, queue for later
          if (!navigator.onLine || response.status >= 500) {
            queuePendingSave({
              result: {
                totalTimeMs: totalMs,
                startedAt: timer.state.raceStartedAt ?? Date.now(),
                completedAt: Date.now(),
                segments,
                template,
                divisionKey,
              },
              title,
              notes,
              divisionKey,
              template,
            });
            setSaved(true);
            return;
          }
          throw new Error("Failed to save");
        }

        const data = await response.json();
        if (data.personalBests) {
          setPersonalBests(data.personalBests);
        }
        if (data.id) {
          setSavedRaceId(data.id);
        }
        setSaved(true);

        // Refresh races + benchmarks lists
        queryClient.invalidateQueries({ queryKey: practiceRaceKeys.lists() });
        queryClient.invalidateQueries({
          queryKey: ["hyrox-station-benchmarks"],
        });
        queryClient.invalidateQueries({
          queryKey: ["plan-recalibration-suggestion"],
        });

        // Surface a PR toast if this finish beat the user's best.
        if (data.isFinishPR && data.id) {
          const seconds = Math.round(totalMs / 1000);
          const priorPart = data.priorBestFinishSeconds
            ? ` (prev ${formatLongTime(data.priorBestFinishSeconds)})`
            : "";
          toast.success(
            `New finish-time PR: ${formatLongTime(seconds)}${priorPart}`,
            {
              description:
                raceType === "actual"
                  ? "Update your profile best time?"
                  : "Update your profile best time? (practice sims also count)",
              duration: 12_000,
              action: {
                label: "Update profile",
                onClick: async () => {
                  try {
                    const res = await fetch(
                      "/api/hyrox/profile/sync-from-race",
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          raceId: data.id,
                          applyFinishPR: true,
                          incrementRaceCount: raceType === "actual",
                          applyDivision: true,
                        }),
                      },
                    );
                    if (!res.ok) throw new Error("Failed");
                    toast.success("Profile updated");
                    queryClient.invalidateQueries({ queryKey: ["profile"] });
                  } catch {
                    toast.error("Couldn't update profile");
                  }
                },
              },
            },
          );
        } else if (data.personalBests && data.personalBests.length > 0) {
          toast.success(
            `Station PR${data.personalBests.length > 1 ? "s" : ""}: ${data.personalBests.join(", ")}`,
          );
        }
      } catch {
        // Queue for offline sync
        const segments = timer.state.completedSegments;
        const totalMs = segments.reduce((sum, s) => sum + s.timeMs, 0);
        queuePendingSave({
          result: {
            totalTimeMs: totalMs,
            startedAt: timer.state.raceStartedAt ?? Date.now(),
            completedAt: Date.now(),
            segments,
            template,
            divisionKey,
          },
          title,
          notes,
          divisionKey,
          template,
        });
        setSaved(true);
      } finally {
        setIsSaving(false);
      }
    },
    [timer, divisionKey, template, queryClient],
  );

  const handleNewRace = useCallback(() => {
    timer.reset(buildFullRaceSegments(divisionKey));
    setSaved(false);
    setSavedRaceId(null);
    setPersonalBests([]);
    setRaceResult(null);
    setScreen("setup");
  }, [timer, divisionKey]);

  const handleBack = useCallback(() => {
    timer.reset(buildFullRaceSegments(divisionKey));
    setSaved(false);
    setSavedRaceId(null);
    setPersonalBests([]);
    setRaceResult(null);
    setScreen("setup");
  }, [timer, divisionKey]);

  // Compute total time from completed segments
  const totalTimeMs = timer.state.completedSegments.reduce(
    (sum, s) => sum + s.timeMs,
    0,
  );

  if (screen === "setup") {
    return <TimerSetup onStart={handleStart} />;
  }

  if (screen === "active" && timer.state.status !== "complete") {
    return (
      <TimerActive
        status={timer.state.status}
        segments={timer.state.segments}
        currentSegmentIndex={timer.state.currentSegmentIndex}
        segmentElapsedMs={timer.segmentElapsedMs}
        totalElapsedMs={timer.totalElapsedMs}
        completedCount={timer.state.completedSegments.length}
        onSplit={handleSplit}
        onPause={timer.pause}
        onResume={timer.resume}
        onEndRace={handleEndRace}
      />
    );
  }

  // Complete screen (either via last split or endRace)
  return (
    <TimerComplete
      completedSegments={timer.state.completedSegments}
      totalTimeMs={totalTimeMs}
      template={template}
      divisionKey={divisionKey}
      isLoggedIn={isLoggedIn}
      onSave={handleSave}
      onNewRace={handleNewRace}
      onBack={handleBack}
      personalBests={personalBests}
      isSaving={isSaving}
      saved={saved}
      savedRaceId={savedRaceId}
    />
  );
}
