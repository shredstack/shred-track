"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  endHealthKitWorkout,
  getHealthKitDistanceMeters,
  isHealthKitAvailable,
  pauseHealthKitWorkout,
  requestHealthKitPermissions,
  resumeHealthKitWorkout,
  startHealthKitWorkout,
} from "@/lib/native/healthkit-timer";
import type { CompletedSegment, TimerStatus } from "./types";

// usePaceFromHealthKit
//
// Owns the iOS-side HealthKit workout session for the duration of a
// race. Returns live pace numbers for the active-race UI:
//
// - `currentRunPaceSecPerKm`: pace for the in-progress run segment,
//   refreshed at 1Hz from HealthKit's cumulative `distanceWalkingRunning`
//   for the segment window. Null on stations / web / before any
//   distance is recorded.
// - `avgRunPaceSecPerKm`: rolling average across completed run
//   segments whose `distanceMeters` was captured. Null until the first
//   run completes.
// - `segmentDistanceMeters`: latest measured distance for the current
//   run segment (1Hz). Null on stations / web.
// - `captureSegmentDistance()`: do a fresh synchronous HealthKit query
//   for the current segment window and return the result. The race
//   timer calls this at the moment of SPLIT so the value stored on the
//   CompletedSegment is current, not up-to-1s stale.
//
// All return values are null on web and on non-iOS native — pace is an
// iOS-only feature per the pace spec §1, §10.

interface UsePaceFromHealthKitOpts {
  status: TimerStatus;
  segmentStartedAt: number | null;
  currentSegmentType: "run" | "station" | null;
  segmentElapsedMs: number;
  completedSegments: CompletedSegment[];
}

interface UsePaceFromHealthKitReturn {
  currentRunPaceSecPerKm: number | null;
  avgRunPaceSecPerKm: number | null;
  segmentDistanceMeters: number | null;
  captureSegmentDistance: () => Promise<number | null>;
}

const POLL_INTERVAL_MS = 1000;

export function usePaceFromHealthKit(
  opts: UsePaceFromHealthKitOpts,
): UsePaceFromHealthKitReturn {
  const {
    status,
    segmentStartedAt,
    currentSegmentType,
    segmentElapsedMs,
    completedSegments,
  } = opts;

  const available = isHealthKitAvailable();

  const [segmentDistanceMeters, setSegmentDistanceMeters] = useState<
    number | null
  >(null);

  // Track lifecycle so we only fire transitions once per state change.
  const sessionStartedRef = useRef(false);
  const lastStatusRef = useRef<TimerStatus>(status);
  const permissionsRequestedRef = useRef(false);

  // ---------------------------------------------------------------------
  // Workout-session lifecycle — driven by status transitions
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!available) return;
    const prev = lastStatusRef.current;
    lastStatusRef.current = status;

    // idle/complete → running: first race start. Request permissions
    // (one-time prompt) and start the HKWorkoutSession.
    if (
      (prev === "idle" || prev === "complete") &&
      status === "running" &&
      !sessionStartedRef.current
    ) {
      sessionStartedRef.current = true;
      void (async () => {
        if (!permissionsRequestedRef.current) {
          permissionsRequestedRef.current = true;
          await requestHealthKitPermissions();
        }
        await startHealthKitWorkout();
      })();
      return;
    }

    if (prev === "running" && status === "paused") {
      void pauseHealthKitWorkout();
      return;
    }

    if (prev === "paused" && status === "running") {
      void resumeHealthKitWorkout();
      return;
    }

    if (status === "complete" && sessionStartedRef.current) {
      sessionStartedRef.current = false;
      void endHealthKitWorkout();
    }
  }, [available, status]);

  // Tear down any in-flight session if the consumer unmounts mid-race.
  useEffect(() => {
    return () => {
      if (sessionStartedRef.current) {
        sessionStartedRef.current = false;
        void endHealthKitWorkout();
      }
    };
  }, []);

  // ---------------------------------------------------------------------
  // 1Hz live distance polling — only during running run segments
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!available) {
      setSegmentDistanceMeters(null);
      return;
    }
    if (
      status !== "running" ||
      currentSegmentType !== "run" ||
      !segmentStartedAt
    ) {
      // Outside a running run segment — clear so the UI shows em-dash.
      setSegmentDistanceMeters(null);
      return;
    }

    let cancelled = false;
    async function poll() {
      const meters = await getHealthKitDistanceMeters(
        segmentStartedAt!,
        Date.now(),
      );
      if (!cancelled) {
        setSegmentDistanceMeters(meters);
      }
    }
    void poll();
    const id = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [available, status, currentSegmentType, segmentStartedAt]);

  // ---------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------

  const currentRunPaceSecPerKm = useMemo<number | null>(() => {
    if (!available) return null;
    if (status !== "running") return null;
    if (currentSegmentType !== "run") return null;
    if (segmentDistanceMeters === null) return null;
    if (segmentDistanceMeters <= 0) return null;
    if (segmentElapsedMs <= 0) return null;
    return (segmentElapsedMs / 1000 / segmentDistanceMeters) * 1000;
  }, [
    available,
    status,
    currentSegmentType,
    segmentDistanceMeters,
    segmentElapsedMs,
  ]);

  const avgRunPaceSecPerKm = useMemo<number | null>(() => {
    if (!available) return null;
    let totalSeconds = 0;
    let totalMeters = 0;
    for (const seg of completedSegments) {
      if (seg.segmentType !== "run") continue;
      if (typeof seg.distanceMeters !== "number") continue;
      if (seg.distanceMeters <= 0) continue;
      totalSeconds += seg.timeMs / 1000;
      totalMeters += seg.distanceMeters;
    }
    if (totalMeters <= 0) return null;
    return (totalSeconds / totalMeters) * 1000;
  }, [available, completedSegments]);

  const captureSegmentDistance = useCallback(async (): Promise<
    number | null
  > => {
    if (!available) return null;
    if (currentSegmentType !== "run") return null;
    if (!segmentStartedAt) return null;
    const meters = await getHealthKitDistanceMeters(
      segmentStartedAt,
      Date.now(),
    );
    return meters;
  }, [available, currentSegmentType, segmentStartedAt]);

  return {
    currentRunPaceSecPerKm,
    avgRunPaceSecPerKm,
    segmentDistanceMeters: available ? segmentDistanceMeters : null,
    captureSegmentDistance,
  };
}
