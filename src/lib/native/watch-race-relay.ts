"use client";

// Watch race relay.
//
// When the user finishes a race on the Apple Watch, the Watch sends the
// payload to the phone via `WCSession.transferUserInfo`. The Swift
// `WatchBridge` plugin receives it (ios/App/App/WatchBridge.swift) and
// fires a `splitsFromWatch` Capacitor event into the WebView. This file
// is the JS companion that:
//
//   1. Listens for `splitsFromWatch`.
//   2. POSTs the payload to /api/hyrox/practice-races (the native
//      bearer-fetch interceptor attaches the Authorization header).
//   3. On success, calls `WatchBridge.ackRaceSync({ raceLocalId })` so
//      the Watch can clear its `PendingRaceQueue` and flip the "Syncing…"
//      indicator off.
//
// On HTTP failure, we deliberately do NOT ack — the Watch keeps the
// race in its pending queue so the user can retry from Settings (or
// it'll auto-resend on next reachability flip once that hook lands).

import { isNativeApp } from "./is-native";

let installed = false;

interface SplitsFromWatchEvent {
  raceLocalId: string;
  payloadJson: string;
}

interface WatchBridge {
  ackRaceSync(opts: { raceLocalId: string }): Promise<void>;
  addListener(
    eventName: "splitsFromWatch",
    listener: (event: SplitsFromWatchEvent) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

function getWatchBridge(): WatchBridge | null {
  if (typeof window === "undefined") return null;
  // @ts-expect-error - Capacitor injects this global at runtime.
  const cap = window.Capacitor;
  const plugin = cap?.Plugins?.WatchBridge as WatchBridge | undefined;
  return plugin ?? null;
}

export function installWatchRaceRelay(): void {
  if (installed) return;
  if (!isNativeApp()) return;
  installed = true;

  const bridge = getWatchBridge();
  if (!bridge) {
    console.warn(
      "[watch-race-relay] WatchBridge plugin not registered — skipping race sync",
    );
    return;
  }

  void bridge.addListener("splitsFromWatch", async (event) => {
    const { raceLocalId, payloadJson } = event;
    if (!raceLocalId || !payloadJson) {
      console.warn("[watch-race-relay] invalid event payload", event);
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(payloadJson);
    } catch (err) {
      console.error("[watch-race-relay] failed to parse payload", err);
      return;
    }

    try {
      const response = await fetch("/api/hyrox/practice-races", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        console.error(
          `[watch-race-relay] save failed ${response.status}: ${body}`,
        );
        return;
      }

      await bridge.ackRaceSync({ raceLocalId });
    } catch (err) {
      console.error("[watch-race-relay] network error saving race", err);
    }
  });
}
