"use client";

import { useSyncExternalStore } from "react";

let isRacing = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return isRacing;
}

function getServerSnapshot(): boolean {
  return false;
}

export function setRaceMode(value: boolean): void {
  if (isRacing === value) return;
  isRacing = value;
  listeners.forEach((listener) => listener());
}

export function useIsRacing(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
