"use client";

// Watch race sync — bidirectional, in-race event channel between the
// phone and the paired Apple Watch.
//
// The phone is the primary surface for race-timer setup; the watch is
// for at-a-glance pace and one-tap splits. Either device can drive the
// race — taps on the phone propagate to the watch and vice versa.
//
// Protocol (mirror on the Swift side in WatchBridge.swift):
//
//   race.start    — phone → watch: hand the watch a fully-described race
//                   to adopt (raceId, segments, startAt, source="phone").
//   race.split    — bidirectional: a segment was completed.
//                   { raceId, segmentOrder, completedAt, originDevice,
//                     distanceMeters? }
//   race.split.enrich — watch → phone: after seeing a phone-originated
//                   split for a run segment, the watch looks up its HK
//                   distance for the segment window and ships it back so
//                   the phone-tapped split keeps its pace data.
//                   { raceId, segmentOrder, distanceMeters }
//   race.pause    — bidirectional. { raceId, at }
//   race.resume   — bidirectional. { raceId, at }
//   race.finish   — bidirectional. End-race tap. { raceId, at }
//   race.cancel   — bidirectional. Cancel pre-race countdown / discard
//                   the in-progress race. { raceId }
//   race.saved    — phone → watch: the phone POSTed this race to the
//                   server and got back a server-side id. The watch
//                   uses this to dismiss its "Save?" prompt and avoid
//                   a duplicate POST. Safe under server-side
//                   idempotency (client_race_id) even if the watch
//                   user taps Save before this arrives.
//                   { raceId, serverRaceId }
//   race.discard  — watch → phone: the watch user tapped Discard on
//                   the complete screen for a finished race. Phone
//                   drops its complete-screen state so it doesn't
//                   linger as a ghost. { raceId }
//
// The Swift plugin uses `WCSession.sendMessage` for low-latency delivery
// when reachable, with a `transferUserInfo` fallback if not — that
// strategy is centralized on the Swift side; JS just calls the bridge.

import { isNativeApp } from "./is-native";
import type { RaceSegment } from "@/components/hyrox/race-timer/types";

let installed = false;

// ---------------------------------------------------------------------------
// Bridge surface (must match WatchBridge.swift @objc methods)
// ---------------------------------------------------------------------------

interface SendRaceStartArgs {
  raceId: string;
  divisionKey: string;
  template: string;
  simulateRoxzone: boolean;
  startAt: number; // UTC ms
  segments: RaceSegment[];
}

interface SendRaceEventArgs {
  raceId: string;
  kind:
    | "race.split"
    | "race.split.enrich"
    | "race.pause"
    | "race.resume"
    | "race.finish"
    | "race.cancel"
    | "race.saved"
    | "race.discard";
  /** JSON-encoded payload — keeps the bridge schema flat. */
  payloadJson: string;
}

interface WatchBridge {
  sendRaceStart(args: SendRaceStartArgs): Promise<void>;
  sendRaceEvent(args: SendRaceEventArgs): Promise<void>;
  addListener(
    eventName: "raceEventFromWatch",
    listener: (event: { kind: string; payloadJson: string }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

function getWatchBridge(): WatchBridge | null {
  if (typeof window === "undefined") return null;
  // @ts-expect-error - Capacitor injects this global at runtime.
  const cap = window.Capacitor;
  const plugin = cap?.Plugins?.WatchBridge as WatchBridge | undefined;
  return plugin ?? null;
}

// ---------------------------------------------------------------------------
// Inbound event dispatch — the orchestrator subscribes via
// `setRaceSyncHandlers` to plug remote events into useRaceTimer.
// ---------------------------------------------------------------------------

export interface RaceSyncHandlers {
  onSplit: (event: {
    raceId: string;
    segmentOrder: number;
    completedAt: number;
    originDevice: "phone" | "watch";
    distanceMeters?: number | null;
  }) => void;
  onSplitEnrichment: (event: {
    raceId: string;
    segmentOrder: number;
    distanceMeters: number;
  }) => void;
  onPause: (event: { raceId: string; at: number }) => void;
  onResume: (event: { raceId: string; at: number }) => void;
  onFinish: (event: { raceId: string; at: number }) => void;
  onCancel: (event: { raceId: string }) => void;
  /** Phone adopts an in-progress race that originated on the watch. */
  onAdoptFromWatch: (event: {
    raceId: string;
    divisionKey: string;
    template: string;
    simulateRoxzone: boolean;
    startAt: number;
    segments: RaceSegment[];
  }) => void;
  /** Watch user discarded a *finished* race from the complete screen.
   *  Phone drops its mirror so it doesn't linger as a ghost. */
  onDiscard: (event: { raceId: string }) => void;
}

let handlers: Partial<RaceSyncHandlers> = {};

export function setRaceSyncHandlers(next: Partial<RaceSyncHandlers>) {
  handlers = { ...handlers, ...next };
}

// ---------------------------------------------------------------------------
// Outbound helpers — the orchestrator + useRaceTimer call these as
// taps happen locally. All become no-ops off-native or when the bridge
// plugin isn't registered, so the web app keeps working unchanged.
// ---------------------------------------------------------------------------

export async function sendRaceStartToWatch(args: SendRaceStartArgs): Promise<void> {
  if (!isNativeApp()) return;
  const bridge = getWatchBridge();
  if (!bridge) return;
  try {
    await bridge.sendRaceStart(args);
  } catch (err) {
    console.warn("[watch-race-sync] sendRaceStart failed", err);
  }
}

async function sendEvent(
  raceId: string,
  kind: SendRaceEventArgs["kind"],
  payload: Record<string, unknown>,
): Promise<void> {
  if (!isNativeApp()) return;
  const bridge = getWatchBridge();
  if (!bridge) return;
  try {
    await bridge.sendRaceEvent({
      raceId,
      kind,
      payloadJson: JSON.stringify({ raceId, ...payload }),
    });
  } catch (err) {
    console.warn(`[watch-race-sync] ${kind} failed`, err);
  }
}

export function sendSplitToWatch(args: {
  raceId: string;
  segmentOrder: number;
  completedAt: number;
  distanceMeters?: number | null;
}): Promise<void> {
  return sendEvent(args.raceId, "race.split", {
    segmentOrder: args.segmentOrder,
    completedAt: args.completedAt,
    originDevice: "phone",
    distanceMeters: args.distanceMeters ?? null,
  });
}

export function sendPauseToWatch(args: { raceId: string; at: number }): Promise<void> {
  return sendEvent(args.raceId, "race.pause", { at: args.at });
}

export function sendResumeToWatch(args: { raceId: string; at: number }): Promise<void> {
  return sendEvent(args.raceId, "race.resume", { at: args.at });
}

export function sendFinishToWatch(args: { raceId: string; at: number }): Promise<void> {
  return sendEvent(args.raceId, "race.finish", { at: args.at });
}

export function sendCancelToWatch(args: { raceId: string }): Promise<void> {
  return sendEvent(args.raceId, "race.cancel", {});
}

/// Phone → Watch: a race we know the phone POSTed to the server (with
/// the shared `raceId` as its idempotency key) is now saved. The watch
/// uses this to dismiss its complete-screen "Save?" prompt — server-
/// side idempotency makes it safe either way, this just keeps the UI
/// from prompting for a save that's already happened.
export function sendRaceSavedToWatch(args: {
  raceId: string;
  serverRaceId: string;
}): Promise<void> {
  return sendEvent(args.raceId, "race.saved", {
    serverRaceId: args.serverRaceId,
  });
}

// ---------------------------------------------------------------------------
// Inbound — install the Capacitor event listener once at app bootstrap.
// ---------------------------------------------------------------------------

export function installWatchRaceSyncListener(): void {
  if (installed) return;
  if (!isNativeApp()) return;
  installed = true;

  const bridge = getWatchBridge();
  if (!bridge) {
    console.warn(
      "[watch-race-sync] WatchBridge plugin not registered — skipping race-sync listener",
    );
    return;
  }

  try {
    void bridge.addListener("raceEventFromWatch", (event) => {
      if (!event?.kind || !event?.payloadJson) return;
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(event.payloadJson);
      } catch (err) {
        console.warn("[watch-race-sync] bad payload JSON", err);
        return;
      }
      const raceId = String(payload.raceId ?? "");
      if (!raceId) return;

      switch (event.kind) {
        case "race.start":
          handlers.onAdoptFromWatch?.({
            raceId,
            divisionKey: String(payload.divisionKey ?? ""),
            template: String(payload.template ?? "full"),
            simulateRoxzone: Boolean(payload.simulateRoxzone),
            startAt: Number(payload.startAt ?? Date.now()),
            segments: Array.isArray(payload.segments)
              ? (payload.segments as RaceSegment[])
              : [],
          });
          break;
        case "race.split":
          handlers.onSplit?.({
            raceId,
            segmentOrder: Number(payload.segmentOrder ?? 0),
            completedAt: Number(payload.completedAt ?? Date.now()),
            originDevice:
              (payload.originDevice as "phone" | "watch") ?? "watch",
            distanceMeters:
              typeof payload.distanceMeters === "number"
                ? (payload.distanceMeters as number)
                : null,
          });
          break;
        case "race.split.enrich":
          handlers.onSplitEnrichment?.({
            raceId,
            segmentOrder: Number(payload.segmentOrder ?? 0),
            distanceMeters: Number(payload.distanceMeters ?? 0),
          });
          break;
        case "race.pause":
          handlers.onPause?.({
            raceId,
            at: Number(payload.at ?? Date.now()),
          });
          break;
        case "race.resume":
          handlers.onResume?.({
            raceId,
            at: Number(payload.at ?? Date.now()),
          });
          break;
        case "race.finish":
          handlers.onFinish?.({
            raceId,
            at: Number(payload.at ?? Date.now()),
          });
          break;
        case "race.cancel":
          handlers.onCancel?.({ raceId });
          break;
        case "race.discard":
          // Watch user discarded a finished race; phone should drop
          // its mirror. Reuse the cancel handler semantics so we end
          // up back at setup.
          handlers.onDiscard?.({ raceId });
          break;
        // race.saved flows phone → watch only. If it ever arrives the
        // other direction we ignore it; the phone is the POSTing side.
      }
    });
  } catch (err) {
    console.warn("[watch-race-sync] failed to install listener", err);
  }
}
