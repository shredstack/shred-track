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
import { sendRaceSavedToWatch } from "./watch-race-sync";

let installed = false;

// ---------------------------------------------------------------------------
// Phone-side "watch race was just saved" subscribe API. The race-timer
// flow uses this to flip its complete screen from "Saved on Watch
// (syncing)…" → "Saved from your Watch ✓" without round-tripping
// through the watch first. Independent of `race.saved` (which flows
// phone → watch); this is a same-process notification on the phone.
// ---------------------------------------------------------------------------

type WatchRaceSavedEvent = { raceId: string; serverRaceId?: string };
type WatchRaceSavedListener = (event: WatchRaceSavedEvent) => void;
const watchRaceSavedListeners = new Set<WatchRaceSavedListener>();

export function onWatchRaceSaved(listener: WatchRaceSavedListener): () => void {
  watchRaceSavedListeners.add(listener);
  return () => watchRaceSavedListeners.delete(listener);
}

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

  console.log("[watch-race-relay] installing splitsFromWatch listener");
  try {
    // Capacitor's plugin proxy returns the listener handle synchronously
    // for some setups (no .then), so don't await/chain — just register.
    void bridge.addListener("splitsFromWatch", async (event) => {
      console.log("[watch-race-relay] received splitsFromWatch event", {
        raceLocalId: event?.raceLocalId,
        payloadBytes: event?.payloadJson?.length,
      });
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

      // Client-supplied race id, shared between watch and phone. Older
      // watch builds (pre-watch_finish_owns_save_spec) didn't include
      // it, so leave undefined when absent — the server will mint a
      // new id like before.
      const clientRaceId =
        typeof (payload as { raceId?: unknown }).raceId === "string"
          ? ((payload as { raceId: string }).raceId)
          : undefined;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.warn(
          "[watch-race-relay] fetch timed out after 15s — aborting",
        );
        controller.abort();
      }, 15000);

      try {
        console.log("[watch-race-relay] POSTing race to /api/hyrox/practice-races");
        const postStart = Date.now();
        const response = await fetch("/api/hyrox/practice-races", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        console.log(
          `[watch-race-relay] fetch resolved in ${Date.now() - postStart}ms status=${response.status}`,
        );

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          console.error(
            `[watch-race-relay] save failed ${response.status}: ${body}`,
          );
          return;
        }

        // Read the server's race id once and reuse for both the ack
        // and the race.saved broadcast. response.json() can only be
        // called once — don't try again later.
        let serverRaceId: string | undefined;
        try {
          const json = (await response.json()) as { id?: string };
          if (typeof json.id === "string") serverRaceId = json.id;
        } catch {
          // Non-JSON or empty body — fine, race.saved still works
          // without a serverRaceId (the watch only needs raceId).
        }

        console.log(
          "[watch-race-relay] POST succeeded, acking race",
          raceLocalId,
        );
        await bridge.ackRaceSync({ raceLocalId });
        console.log("[watch-race-relay] ack sent to watch");

        // Tell the watch the server now has this race so it can
        // dismiss its complete-screen Save? prompt. Server-side
        // idempotency (client_race_id) means a redundant watch-tap
        // is harmless, but UX-wise we don't want the watch to prompt
        // the user for a save that's already happened.
        if (clientRaceId) {
          void sendRaceSavedToWatch({
            raceId: clientRaceId,
            serverRaceId: serverRaceId ?? "",
          });

          // Notify same-process listeners (the race timer flow) so
          // its complete screen can flip out of the "Saved on Watch
          // (syncing)…" placeholder into the success state.
          for (const fn of watchRaceSavedListeners) {
            try {
              fn({ raceId: clientRaceId, serverRaceId });
            } catch (err) {
              console.warn("[watch-race-relay] saved listener threw", err);
            }
          }
        }
      } catch (err) {
        const isAbort =
          err instanceof Error &&
          (err.name === "AbortError" || err.message.includes("abort"));
        console.error(
          `[watch-race-relay] ${isAbort ? "fetch aborted (timeout)" : "network error saving race"}`,
          err,
        );
      } finally {
        clearTimeout(timeoutId);
      }
    });
    console.log("[watch-race-relay] splitsFromWatch listener registered");
  } catch (err) {
    console.error("[watch-race-relay] failed to attach listener", err);
  }
}
