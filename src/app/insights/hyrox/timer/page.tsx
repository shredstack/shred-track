"use client";

import { useEffect } from "react";
import { RaceTimerFlow } from "@/components/hyrox/race-timer";

export default function PublicRaceTimerPage() {
  // Register service worker for offline timer support
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Service worker registration failed — non-critical
      });
    }
  }, []);

  return <RaceTimerFlow />;
}
