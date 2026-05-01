"use client";

// HealthKit timer wrapper.
//
// Thin JS surface over the Swift `HealthKitTimer` Capacitor plugin (see
// native/iOSApp/Plugins/HealthKitTimer.swift). The plugin owns a single
// `HKWorkoutSession` for the duration of an iPhone-side HYROX race and
// answers per-window distance queries used by the pace UI.
//
// Every call no-ops (or returns a safe default) on web and on
// non-iOS native — pace tracking is iOS-only per pace spec §1, §10.

import { isNativeApp, nativePlatform } from "./is-native";

interface HealthKitTimerPlugin {
  requestPermissions(): Promise<{
    granted: boolean;
    available: boolean;
    error?: string;
  }>;
  startWorkout(): Promise<{ started?: boolean }>;
  pauseWorkout(): Promise<void>;
  resumeWorkout(): Promise<void>;
  endWorkout(): Promise<void>;
  getDistanceMeters(opts: { from: number; to: number }): Promise<{
    meters: number;
  }>;
}

function getPlugin(): HealthKitTimerPlugin | null {
  if (!isNativeApp() || nativePlatform() !== "ios") return null;
  if (typeof window === "undefined") return null;
  // @ts-expect-error - Capacitor injects this global at runtime.
  const cap = window.Capacitor;
  const plugin = cap?.Plugins?.HealthKitTimer as
    | HealthKitTimerPlugin
    | undefined;
  return plugin ?? null;
}

export function isHealthKitAvailable(): boolean {
  return getPlugin() !== null;
}

export async function requestHealthKitPermissions(): Promise<boolean> {
  const plugin = getPlugin();
  if (!plugin) return false;
  try {
    const result = await plugin.requestPermissions();
    return Boolean(result?.granted);
  } catch {
    return false;
  }
}

export async function startHealthKitWorkout(): Promise<boolean> {
  const plugin = getPlugin();
  if (!plugin) return false;
  try {
    await plugin.startWorkout();
    return true;
  } catch {
    return false;
  }
}

export async function pauseHealthKitWorkout(): Promise<void> {
  const plugin = getPlugin();
  if (!plugin) return;
  try {
    await plugin.pauseWorkout();
  } catch {
    // noop
  }
}

export async function resumeHealthKitWorkout(): Promise<void> {
  const plugin = getPlugin();
  if (!plugin) return;
  try {
    await plugin.resumeWorkout();
  } catch {
    // noop
  }
}

export async function endHealthKitWorkout(): Promise<void> {
  const plugin = getPlugin();
  if (!plugin) return;
  try {
    await plugin.endWorkout();
  } catch {
    // noop
  }
}

/**
 * Cumulative `distanceWalkingRunning` over `[from, to]` in meters.
 * Timestamps are ms-since-epoch (matches `Date.now()` on the JS side).
 * Returns 0 on web / failure.
 */
export async function getHealthKitDistanceMeters(
  from: number,
  to: number,
): Promise<number> {
  const plugin = getPlugin();
  if (!plugin) return 0;
  try {
    const result = await plugin.getDistanceMeters({ from, to });
    return Math.max(0, result?.meters ?? 0);
  } catch {
    return 0;
  }
}
