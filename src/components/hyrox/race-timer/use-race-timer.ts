"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CompletedSegment,
  RaceSegment,
  TimerState,
  TimerStatus,
  PracticeRaceResult,
} from "./types";

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = "shredtrack-race-timer";

function saveState(state: TimerState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable — non-critical
  }
}

function loadState(): TimerState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as TimerState;
  } catch {
    return null;
  }
}

function clearState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // noop
  }
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

function makeInitialState(segments: RaceSegment[]): TimerState {
  return {
    status: "idle",
    raceStartedAt: null,
    segmentStartedAt: null,
    pausedAt: null,
    totalPausedMs: 0,
    segments,
    completedSegments: [],
    currentSegmentIndex: 0,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseRaceTimerReturn {
  state: TimerState;
  /** Current segment elapsed time in ms (updates via rAF) */
  segmentElapsedMs: number;
  /** Total race elapsed time in ms (updates via rAF) */
  totalElapsedMs: number;
  /** Start the race (from idle) */
  start: () => void;
  /** Advance to the next segment (split) */
  split: () => void;
  /** Pause the timer */
  pause: () => void;
  /** Resume from pause */
  resume: () => void;
  /** End the race early */
  endRace: () => PracticeRaceResult;
  /** Reset everything back to idle with new segments */
  reset: (segments: RaceSegment[]) => void;
  /** Whether a saved in-progress race was recovered from localStorage */
  recovered: boolean;
  /** Discard recovered state */
  discardRecovery: () => void;
}

export function useRaceTimer(initialSegments: RaceSegment[]): UseRaceTimerReturn {
  const [recovered, setRecovered] = useState(false);
  const [state, setState] = useState<TimerState>(() => {
    const saved = loadState();
    if (saved && saved.status !== "idle" && saved.status !== "complete") {
      setRecovered(true);
      return saved;
    }
    return makeInitialState(initialSegments);
  });

  // Animated elapsed values (updated via rAF, not React state, for perf)
  const [segmentElapsedMs, setSegmentElapsedMs] = useState(0);
  const [totalElapsedMs, setTotalElapsedMs] = useState(0);
  const rafRef = useRef<number>(0);

  // Persist state changes
  useEffect(() => {
    saveState(state);
  }, [state]);

  // ---------------------------------------------------------------------------
  // rAF display loop
  // ---------------------------------------------------------------------------

  useEffect(() => {
    function tick() {
      const { status, segmentStartedAt, raceStartedAt, totalPausedMs, pausedAt } = state;

      if (status === "running" && segmentStartedAt && raceStartedAt) {
        const now = performance.timeOrigin + performance.now();
        setSegmentElapsedMs(now - segmentStartedAt);
        setTotalElapsedMs(now - raceStartedAt - totalPausedMs);
      } else if (status === "paused" && pausedAt && segmentStartedAt && raceStartedAt) {
        // Show frozen values while paused
        setSegmentElapsedMs(pausedAt - segmentStartedAt);
        setTotalElapsedMs(pausedAt - raceStartedAt - totalPausedMs);
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    if (state.status === "running" || state.status === "paused") {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      setSegmentElapsedMs(0);
      // Keep totalElapsedMs for complete state
    }

    return () => cancelAnimationFrame(rafRef.current);
  }, [state]);

  // ---------------------------------------------------------------------------
  // Wake Lock
  // ---------------------------------------------------------------------------

  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    async function acquireWakeLock() {
      if ("wakeLock" in navigator) {
        try {
          wakeLockRef.current = await navigator.wakeLock.request("screen");
        } catch {
          // Wake lock failed — non-critical
        }
      }
    }

    if (state.status === "running" || state.status === "paused") {
      acquireWakeLock();
    } else {
      wakeLockRef.current?.release();
      wakeLockRef.current = null;
    }

    return () => {
      wakeLockRef.current?.release();
      wakeLockRef.current = null;
    };
  }, [state.status]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const start = useCallback(() => {
    const now = Date.now();
    setState((prev) => ({
      ...prev,
      status: "running" as TimerStatus,
      raceStartedAt: now,
      segmentStartedAt: now,
      pausedAt: null,
      totalPausedMs: 0,
      completedSegments: [],
      currentSegmentIndex: 0,
    }));
  }, []);

  const split = useCallback(() => {
    setState((prev) => {
      if (prev.status !== "running" || !prev.segmentStartedAt) return prev;

      const now = Date.now();
      const segTime = now - prev.segmentStartedAt;
      const seg = prev.segments[prev.currentSegmentIndex];

      const completed: CompletedSegment = {
        segmentOrder: prev.currentSegmentIndex + 1,
        segmentType: seg.segmentType,
        label: seg.label,
        timeMs: segTime,
      };

      const nextIndex = prev.currentSegmentIndex + 1;
      const isLast = nextIndex >= prev.segments.length;

      return {
        ...prev,
        status: isLast ? ("complete" as TimerStatus) : ("running" as TimerStatus),
        completedSegments: [...prev.completedSegments, completed],
        currentSegmentIndex: nextIndex,
        segmentStartedAt: isLast ? null : now,
      };
    });
  }, []);

  const pause = useCallback(() => {
    setState((prev) => {
      if (prev.status !== "running") return prev;
      return { ...prev, status: "paused" as TimerStatus, pausedAt: Date.now() };
    });
  }, []);

  const resume = useCallback(() => {
    setState((prev) => {
      if (prev.status !== "paused" || !prev.pausedAt) return prev;
      const pauseDuration = Date.now() - prev.pausedAt;
      return {
        ...prev,
        status: "running" as TimerStatus,
        pausedAt: null,
        segmentStartedAt: (prev.segmentStartedAt ?? 0) + pauseDuration,
        totalPausedMs: prev.totalPausedMs + pauseDuration,
      };
    });
  }, []);

  const buildResult = useCallback(
    (s: TimerState): PracticeRaceResult => {
      const totalMs = s.completedSegments.reduce((sum, seg) => sum + seg.timeMs, 0);
      return {
        totalTimeMs: totalMs,
        startedAt: s.raceStartedAt ?? Date.now(),
        completedAt: Date.now(),
        segments: s.completedSegments,
        template: "full",
        divisionKey: "",
      };
    },
    [],
  );

  const endRace = useCallback((): PracticeRaceResult => {
    let result: PracticeRaceResult | null = null;

    setState((prev) => {
      // Complete the current segment if running
      const now = Date.now();
      let completed = [...prev.completedSegments];

      if (
        prev.status === "running" &&
        prev.segmentStartedAt &&
        prev.currentSegmentIndex < prev.segments.length
      ) {
        const seg = prev.segments[prev.currentSegmentIndex];
        completed.push({
          segmentOrder: prev.currentSegmentIndex + 1,
          segmentType: seg.segmentType,
          label: seg.label,
          timeMs: now - prev.segmentStartedAt,
        });
      }

      const next: TimerState = {
        ...prev,
        status: "complete",
        completedSegments: completed,
        segmentStartedAt: null,
        pausedAt: null,
      };

      result = buildResult(next);
      return next;
    });

    // result will be set synchronously by the setState callback
    return result!;
  }, [buildResult]);

  const reset = useCallback((segments: RaceSegment[]) => {
    clearState();
    setRecovered(false);
    setSegmentElapsedMs(0);
    setTotalElapsedMs(0);
    setState(makeInitialState(segments));
  }, []);

  const discardRecovery = useCallback(() => {
    clearState();
    setRecovered(false);
    setSegmentElapsedMs(0);
    setTotalElapsedMs(0);
    setState(makeInitialState(initialSegments));
  }, [initialSegments]);

  return {
    state,
    segmentElapsedMs,
    totalElapsedMs,
    start,
    split,
    pause,
    resume,
    endRace,
    reset,
    recovered,
    discardRecovery,
  };
}
