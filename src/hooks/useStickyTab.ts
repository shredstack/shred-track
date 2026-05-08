"use client";

import { useCallback, useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// Sticky tab store — persists per-page tab selection in localStorage so a
// refresh keeps the user on the tab they last picked. Each `key` (e.g.
// "recovery", "crossfit") gets its own slot. Mirrors `useUnits`' external
// store pattern so SSR/CSR hydration stays consistent (server snapshot is
// always `null`; the client reads localStorage and re-renders on mount).
// ---------------------------------------------------------------------------

const STORAGE_PREFIX = "shredtrack-tab:";

type Store = {
  value: string | null;
  listeners: Set<() => void>;
};

const stores = new Map<string, Store>();

function getStore(key: string): Store {
  let s = stores.get(key);
  if (s) return s;
  s = { value: null, listeners: new Set() };
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(STORAGE_PREFIX + key);
      if (stored !== null) s.value = stored;
    } catch {
      // noop
    }
  }
  stores.set(key, s);
  return s;
}

function setStored(key: string, value: string): void {
  const s = getStore(key);
  if (s.value === value) return;
  s.value = value;
  try {
    localStorage.setItem(STORAGE_PREFIX + key, value);
  } catch {
    // noop
  }
  s.listeners.forEach((l) => l());
}

export function useStickyTab<T extends string>(
  key: string,
): [T | null, (value: T) => void] {
  const subscribe = useCallback(
    (listener: () => void) => {
      const s = getStore(key);
      s.listeners.add(listener);
      return () => {
        s.listeners.delete(listener);
      };
    },
    [key],
  );

  const value = useSyncExternalStore(
    subscribe,
    () => getStore(key).value as T | null,
    () => null,
  );

  const set = useCallback(
    (next: T) => {
      setStored(key, next);
    },
    [key],
  );

  return [value, set];
}
