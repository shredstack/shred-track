// Helpers for working with the per-set lifting data on
// score_movement_details.setEntries.
//
// The canonical shape is `SetEntry[]` ({ weight, reps?, rpe? }), but the
// JSONB column may still contain the legacy `number[]` shape on rows that
// pre-date the 20260429 migration (or on cached client state). These helpers
// normalize either shape into the canonical one.

import type { SetEntry } from "@/types/crossfit";

export function normalizeSetEntries(raw: unknown): SetEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: SetEntry[] = [];
  for (const item of raw) {
    if (typeof item === "number" && Number.isFinite(item) && item > 0) {
      out.push({ weight: item });
      continue;
    }
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const weight = Number(obj.weight);
      if (!Number.isFinite(weight) || weight <= 0) continue;
      const reps =
        obj.reps != null && Number.isFinite(Number(obj.reps))
          ? Number(obj.reps)
          : undefined;
      const rpe =
        obj.rpe != null && Number.isFinite(Number(obj.rpe))
          ? Number(obj.rpe)
          : undefined;
      out.push({ weight, ...(reps != null ? { reps } : {}), ...(rpe != null ? { rpe } : {}) });
    }
  }
  return out;
}

export function maxWeight(entries: SetEntry[]): number {
  return entries.reduce((max, e) => (e.weight > max ? e.weight : max), 0);
}
