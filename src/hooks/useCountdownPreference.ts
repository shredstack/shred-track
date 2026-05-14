"use client";

import { useCallback, useSyncExternalStore } from "react";

// Countdown preference for the practice-race timer. Stored in
// localStorage and shared across components via a tiny external store
// (same pattern as `useUnits`) so the picker in setup, the active screen,
// and the watch-bridge relay all see the same value without prop drilling.
//
// 0 = off (start immediately). Any other value is the number of seconds
// to count down before the race clock starts ticking.

export type CountdownSeconds = 0 | 3 | 5 | 10;

const STORAGE_KEY = "shredtrack.timer.countdownSeconds";
const ALLOWED: CountdownSeconds[] = [0, 3, 5, 10];
const DEFAULT: CountdownSeconds = 10;

let currentSeconds: CountdownSeconds = DEFAULT;
const listeners = new Set<() => void>();

function getSnapshot(): CountdownSeconds {
  return currentSeconds;
}

function getServerSnapshot(): CountdownSeconds {
  return DEFAULT;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setValue(next: CountdownSeconds): void {
  if (next === currentSeconds) return;
  currentSeconds = next;
  try {
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // noop
  }
  listeners.forEach((l) => l());
}

if (typeof window !== "undefined") {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed = Number(raw);
      if ((ALLOWED as number[]).includes(parsed)) {
        currentSeconds = parsed as CountdownSeconds;
      }
    }
  } catch {
    // noop
  }
}

export function useCountdownPreference() {
  const seconds = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setSeconds = useCallback((next: CountdownSeconds) => {
    setValue(next);
  }, []);
  return { seconds, setSeconds, options: ALLOWED };
}

export function getCountdownPreference(): CountdownSeconds {
  return currentSeconds;
}
