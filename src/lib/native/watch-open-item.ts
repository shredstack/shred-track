"use client";

// watch-open-item.ts — listens for "Open on iPhone" taps from the
// Watch's TodayDetailView (spec watch_today_view_and_nudges_spec.md §6.2).
//
// Flow:
//   1. User taps "Open on iPhone" on the Watch.
//   2. Watch → iPhone via WCSession.sendMessage(["kind": "openItem",
//      "type", "id"]).
//   3. WatchBridge's didReceiveMessage handler forwards a Capacitor event
//      `openItemFromWatch` to the WebView.
//   4. This listener routes the WebView to the relevant page.
//
// If the user already happens to be on the target page, the router push
// is a no-op — that's fine.

import { isNativeApp } from "./is-native";

let installed = false;

interface OpenItemEvent {
  type: "hyrox" | "crossfit" | "recovery";
  id: string;
}

interface WatchBridge {
  addListener(
    eventName: "openItemFromWatch",
    listener: (event: OpenItemEvent) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

function getWatchBridge(): WatchBridge | null {
  if (typeof window === "undefined") return null;
  // @ts-expect-error - Capacitor injects this global at runtime.
  const cap = window.Capacitor;
  const plugin = cap?.Plugins?.WatchBridge as WatchBridge | undefined;
  return plugin ?? null;
}

function urlForItem(event: OpenItemEvent): string | null {
  switch (event.type) {
    case "hyrox":
      // The HYROX plan today view will surface the logging UI for the
      // current session — preferred over a deep link to a session-by-id
      // page that might not exist on every plan layout.
      return "/hyrox/plan";
    case "crossfit":
      return `/crossfit/wod/${event.id}`;
    case "recovery":
      return "/recovery";
    default:
      return null;
  }
}

export function installWatchOpenItemListener(): void {
  if (installed) return;
  if (!isNativeApp()) return;
  installed = true;

  const bridge = getWatchBridge();
  if (!bridge) return;

  try {
    void bridge.addListener("openItemFromWatch", (event) => {
      const url = urlForItem(event);
      if (!url) return;
      // Use a soft navigation so we don't tear down the WebView.
      try {
        window.history.pushState({}, "", url);
        // Trigger a popstate/route change so Next.js App Router picks
        // it up. We can't import next/navigation here (it pins us to a
        // specific React tree), so just dispatch a popstate.
        window.dispatchEvent(new PopStateEvent("popstate"));
      } catch (err) {
        // Hard fallback.
        console.warn("[watch-open-item] soft nav failed, hard reloading", err);
        window.location.assign(url);
      }
    });
  } catch (err) {
    console.warn("[watch-open-item] failed to register listener", err);
  }
}
