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

// Parse a rep scheme string like "5-5-5-5-5" or "10-10-7-7-3" into per-set
// prescribed rep counts. Only whole-number segments count; non-numeric
// segments ("max", "amrap") are dropped. Mirrors the parser used in the
// score-entry UI so prescribed-rep logic agrees on both sides.
export function parseRepScheme(repScheme?: string | null): number[] {
  if (!repScheme) return [];
  return repScheme
    .split("-")
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map((s) => parseInt(s, 10));
}

// Prescribed reps for the set at index `setIdx`. A multi-value scheme maps one
// value per set; a single value applies to every set; extra sets beyond the
// scheme reuse the last prescribed value. Returns undefined when the scheme
// carries no numeric info.
export function prescribedRepsForSet(
  repScheme: string | null | undefined,
  setIdx: number
): number | undefined {
  const parts = parseRepScheme(repScheme);
  if (parts.length === 0) return undefined;
  if (setIdx < parts.length) return parts[setIdx];
  return parts[parts.length - 1];
}

// The heaviest set that COUNTS as a load score: the top working set whose
// logged reps met its prescription. A set with no logged reps is assumed to
// have hit the prescription — the UI only stores per-set reps when the athlete
// overrides them (e.g. a missed final rep). When the scheme is unknown every
// set counts (we can't judge). If no set met its prescription (every set fell
// short), falls back to the overall heaviest set so a score is still produced.
export function qualifyingTopSetWeight(
  entries: SetEntry[],
  repScheme?: string | null
): number {
  let qualifyingMax = 0;
  let overallMax = 0;
  entries.forEach((e, i) => {
    if (e.weight > overallMax) overallMax = e.weight;
    const prescribed = prescribedRepsForSet(repScheme, i);
    const metPrescription =
      e.reps == null || prescribed == null || e.reps >= prescribed;
    if (metPrescription && e.weight > qualifyingMax) qualifyingMax = e.weight;
  });
  return qualifyingMax > 0 ? qualifyingMax : overallMax;
}
