"use client";

// Watch race templates sync.
//
// Pushes the user's custom HYROX race templates to the paired Apple
// Watch as soon as the native app launches with an authenticated
// session (and again on every fresh sign-in). Before this, templates
// only reached the watch after the user navigated to Race Tools on the
// phone, because that's the only place `useRaceTemplates()` mounted.
//
// Token refresh events are intentionally ignored — the template list
// rarely changes, and `pushRaceTemplatesToWatch` already dedupes
// identical payloads via its internal `lastPushedJson` guard.

import { createClient } from "@/lib/supabase/client";
import { isNativeApp } from "./is-native";
import { pushRaceTemplatesToWatch } from "./race-templates-snapshot";
import type { RaceTemplatesResponse } from "@/hooks/useRaceTemplates";

let installed = false;

async function fetchAndPush(): Promise<void> {
  try {
    const response = await fetch("/api/hyrox/race-templates");
    if (!response.ok) return;
    const data = (await response.json()) as RaceTemplatesResponse;
    if (data.mine) await pushRaceTemplatesToWatch(data.mine);
  } catch (err) {
    console.warn("[watch-race-templates-sync] fetch failed", err);
  }
}

export function installWatchRaceTemplatesSync(): void {
  if (installed) return;
  if (!isNativeApp()) return;
  installed = true;

  const supabase = createClient();

  // Initial push if a session is already live at app start.
  void supabase.auth.getSession().then(({ data }) => {
    if (data.session) void fetchAndPush();
  });

  // Re-push after a fresh sign-in (a different user, or sign-in after
  // sign-out). Skip TOKEN_REFRESHED — templates haven't changed.
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN") void fetchAndPush();
  });
}
