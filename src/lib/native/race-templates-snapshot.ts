"use client";

// race-templates-snapshot.ts — opportunistic push of the user's saved
// HYROX race templates from the phone to the Watch.
//
// The Watch has no auth-protected HTTP path of its own for race
// templates — the simplest sync model is "phone owns the truth, pushes
// a snapshot via WCSession.updateApplicationContext after every read of
// the list". The Watch decodes it once and uses it locally to populate
// its template picker.
//
// Mirrors the today-snapshot.ts shape: a single Capacitor plugin call
// hands the bridge a JSON string; the Swift side stuffs it under the
// `raceTemplates` key in the merged applicationContext.

import { isNativeApp } from "./is-native";
import type { RaceTemplate } from "@/hooks/useRaceTemplates";

interface WatchBridge {
  pushRaceTemplates(opts: { json: string }): Promise<void>;
}

function getWatchBridge(): WatchBridge | null {
  if (typeof window === "undefined") return null;
  // @ts-expect-error - Capacitor injects this global at runtime.
  const cap = window.Capacitor;
  const plugin = cap?.Plugins?.WatchBridge as WatchBridge | undefined;
  return plugin ?? null;
}

// The Watch-side RaceSegment model stores distanceMeters as an integer
// (no display string) plus an id required by SwiftUI list keys. We map
// to that shape here so the Watch can decode directly into its native
// model without a separate template-segment type.
interface WatchSnapshotSegment {
  id: string;
  segmentType: "run" | "station";
  segmentSubtype?: "prescribed_run" | "roxzone" | null;
  label: string;
  distanceMeters?: number;
  reps?: number;
  weightLabel?: string;
}

interface WatchSnapshotTemplate {
  id: string;
  name: string;
  divisionKey: string | null;
  simulateRoxzone: boolean;
  segments: WatchSnapshotSegment[];
}

interface WatchSnapshot {
  generatedAt: number;
  templates: WatchSnapshotTemplate[];
}

function toWatchShape(templates: RaceTemplate[]): WatchSnapshot {
  return {
    generatedAt: Math.floor(Date.now() / 1000),
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      divisionKey: t.divisionKey,
      simulateRoxzone: t.simulateRoxzone,
      segments: t.segments.map((s, idx) => ({
        id: `${t.id}-${idx}`,
        segmentType: s.segmentType,
        segmentSubtype: s.segmentSubtype ?? null,
        label: s.label,
        distanceMeters: s.distanceMeters,
        reps: s.reps,
        weightLabel: s.weightLabel,
      })),
    })),
  };
}

let lastPushedJson: string | null = null;

export async function pushRaceTemplatesToWatch(
  templates: RaceTemplate[],
): Promise<void> {
  if (!isNativeApp()) return;
  const bridge = getWatchBridge();
  if (!bridge) return;

  const snapshot = toWatchShape(templates);
  const json = JSON.stringify(snapshot);

  // Skip the bridge call when nothing structurally changed — every
  // React Query refetch triggers this path, and applicationContext is
  // whole-dictionary latest-wins, so a no-op push burns the slot for
  // no UX gain. We compare the JSON *minus* generatedAt so a refetch
  // with identical templates doesn't slip through. The userId of the
  // first template (or a sentinel when empty) is folded in so a
  // sign-out → sign-in-as-different-user pushes even if the
  // post-sign-in list happens to match a prior cached payload.
  const ownerId = templates[0]?.userId ?? "anon";
  const compareKey = JSON.stringify({ ownerId, templates: snapshot.templates });
  if (compareKey === lastPushedJson) return;
  lastPushedJson = compareKey;

  try {
    await bridge.pushRaceTemplates({ json });
  } catch (err) {
    console.warn("[race-templates-snapshot] push failed", err);
  }
}
