"use client";

import { useState, useEffect, useCallback, useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UnitMode = "metric" | "mixed";

// ---------------------------------------------------------------------------
// Shared external store — keeps all components in sync without React context
// ---------------------------------------------------------------------------

const STORAGE_KEY = "shredtrack-unit-preference";

let currentMode: UnitMode = "metric";
const listeners = new Set<() => void>();

function getSnapshot(): UnitMode {
  return currentMode;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setMode(mode: UnitMode): void {
  if (mode === currentMode) return;
  currentMode = mode;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // noop
  }
  listeners.forEach((l) => l());
}

// Initialize from localStorage on first load (client-side only)
if (typeof window !== "undefined") {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "metric" || stored === "mixed") {
      currentMode = stored;
    }
  } catch {
    // noop
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useUnits() {
  const mode = useSyncExternalStore(subscribe, getSnapshot, () => "metric" as UnitMode);

  const toggle = useCallback(() => {
    setMode(mode === "metric" ? "mixed" : "metric");
  }, [mode]);

  const setUnitMode = useCallback((m: UnitMode) => {
    setMode(m);
  }, []);

  return {
    mode,
    isMixed: mode === "mixed",
    toggle,
    setMode: setUnitMode,
  };
}
