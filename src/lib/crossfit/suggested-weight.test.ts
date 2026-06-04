import { describe, expect, it } from "vitest";
import {
  computeMovementHistorySuggestion,
  roundToPlate,
} from "./suggested-weight";

describe("roundToPlate", () => {
  it("uses 5 lb steps at and above 75 lb", () => {
    expect(roundToPlate(75)).toBe(75);
    expect(roundToPlate(77)).toBe(75);
    expect(roundToPlate(78)).toBe(80);
    expect(roundToPlate(112)).toBe(110);
    expect(roundToPlate(113)).toBe(115);
  });

  it("uses 2.5 lb steps below 75 lb", () => {
    expect(roundToPlate(50)).toBe(50);
    expect(roundToPlate(51)).toBe(50);
    expect(roundToPlate(52)).toBe(52.5);
    expect(roundToPlate(62.4)).toBe(62.5);
  });

  it("handles non-finite / zero inputs", () => {
    expect(roundToPlate(0)).toBe(0);
    expect(roundToPlate(NaN)).toBe(0);
    expect(roundToPlate(-50)).toBe(0);
  });
});

// ============================================
// computeMovementHistorySuggestion — notes_insights_v2_spec.md §4.1
// ============================================
//
// Pure scaling-ratio math for the movement_history tier. Table-driven so
// the cases line up 1:1 with the spec's bullet list:
//   - non-1RM movement with one prior log at a different prescribed weight
//   - prior was Rx → suggests today's prescribed weight
//   - prior log > 90 days old → confidence drops to low
//   - prior with NULL prescribed → falls back to raw priorActualLb, low
//   - upper bound clamps to today's prescribed weight
//   - RPE nudge mirrors direct-history tier (≥9 → 0.95, ≤6 → 1.05)

describe("computeMovementHistorySuggestion", () => {
  it("scales the centerline by the prior scaling ratio (75/105 → ~71% of today)", () => {
    // Push Press: prior was 75 lb against 105 lb prescribed (scaling
    // ratio ~0.714). Today's prescribed is 45 lb → centerline ≈ 32.14 lb,
    // band 30.5–33.75 → rounds to 30 / 35 on 2.5-lb steps (33.75/2.5 =
    // 13.5, Math.round → 14 → 35).
    const r = computeMovementHistorySuggestion({
      priorActualLb: 75,
      priorPrescribedLb: 105,
      todayPrescribedLb: 45,
      rpe: null,
      ageDays: 30,
    });
    expect(r).not.toBeNull();
    expect(r!.confidence).toBe("medium");
    expect(r!.lowLb).toBe(30);
    expect(r!.highLb).toBe(35);
  });

  it("preserves Rx when the prior log was Rx (ratio = 1.0)", () => {
    // Power Clean: prior 95 lb against 95 lb prescribed, today's
    // prescribed 115 lb. Centerline = 115, but the high clamps at the
    // today's prescribed weight ceiling.
    const r = computeMovementHistorySuggestion({
      priorActualLb: 95,
      priorPrescribedLb: 95,
      todayPrescribedLb: 115,
      rpe: null,
      ageDays: 20,
    });
    expect(r).not.toBeNull();
    // Centerline = 115; raw band would be 109.25–120.75; high clamps to
    // today's prescribed (115), low rounds to nearest 5 (110).
    expect(r!.highLb).toBe(115);
    expect(r!.lowLb).toBe(110);
    expect(r!.confidence).toBe("medium");
  });

  it("drops confidence to low when the prior log is older than 90 days", () => {
    const r = computeMovementHistorySuggestion({
      priorActualLb: 75,
      priorPrescribedLb: 105,
      todayPrescribedLb: 105,
      rpe: null,
      ageDays: 120,
    });
    expect(r!.confidence).toBe("low");
  });

  it("falls back to raw priorActualLb and drops to low when priorPrescribedLb is null", () => {
    // Older template with no prescribed-weight column → can't compute a
    // scaling ratio. Centerline = priorActualLb directly.
    const r = computeMovementHistorySuggestion({
      priorActualLb: 35,
      priorPrescribedLb: null,
      todayPrescribedLb: 50,
      rpe: null,
      ageDays: 30,
    });
    expect(r).not.toBeNull();
    expect(r!.confidence).toBe("low");
    // Centerline 35, band 33.25–36.75 → rounds to 32.5–37.5 / 35 etc.
    expect(r!.lowLb).toBe(32.5);
    expect(r!.highLb).toBe(37.5);
  });

  it("clamps the upper bound to today's prescribed weight (never suggests heavier than Rx)", () => {
    // Prior 100 lb against 80 lb prescribed → ratio 1.25 (athlete went
    // heavier than Rx last time). Today's prescribed is 100 lb. Raw band
    // would peak at 1.25*100*1.05 = 131.25; clamp pins high at 100.
    const r = computeMovementHistorySuggestion({
      priorActualLb: 100,
      priorPrescribedLb: 80,
      todayPrescribedLb: 100,
      rpe: null,
      ageDays: 20,
    });
    expect(r!.highLb).toBe(100);
  });

  it("applies the heavy-RPE nudge (RPE ≥ 9 → ×0.95)", () => {
    // Prior 75 against 105, today's 45. Raw centerline 32.14. With RPE 9
    // → 30.54. Band 29.01–32.06 → rounds 30 / 32.5 (29.01/2.5 = 11.6 →
    // 12 → 30; 32.06/2.5 = 12.82 → 13 → 32.5).
    const r = computeMovementHistorySuggestion({
      priorActualLb: 75,
      priorPrescribedLb: 105,
      todayPrescribedLb: 45,
      rpe: 9,
      ageDays: 20,
    });
    expect(r!.lowLb).toBe(30);
    expect(r!.highLb).toBe(32.5);
  });

  it("applies the easy-RPE nudge (RPE ≤ 6 → ×1.05)", () => {
    // Same prior/today as above, RPE 6 → centerline 33.75 → band
    // 32.06–35.44 → rounds 32.5–35.
    const r = computeMovementHistorySuggestion({
      priorActualLb: 75,
      priorPrescribedLb: 105,
      todayPrescribedLb: 45,
      rpe: 6,
      ageDays: 20,
    });
    expect(r!.lowLb).toBe(32.5);
    expect(r!.highLb).toBe(35);
  });

  it("returns null when priorActualLb is missing or non-positive", () => {
    expect(
      computeMovementHistorySuggestion({
        priorActualLb: 0,
        priorPrescribedLb: 100,
        todayPrescribedLb: 100,
        rpe: null,
        ageDays: 20,
      })
    ).toBeNull();
    expect(
      computeMovementHistorySuggestion({
        priorActualLb: -10,
        priorPrescribedLb: 100,
        todayPrescribedLb: 100,
        rpe: null,
        ageDays: 20,
      })
    ).toBeNull();
  });

  it("DB Deadlift repro: 50 → 35 scaled prior + 50 prescribed today", () => {
    // The exact case from the spec's bug report. Prior log: 50 lb
    // prescribed, athlete used 35 lb → scaling ratio 0.7. Today's
    // prescribed is also 50 lb → centerline 35 → band 33.25–36.75 →
    // rounds 32.5–37.5 (2.5-lb steps below 75 lb).
    const r = computeMovementHistorySuggestion({
      priorActualLb: 35,
      priorPrescribedLb: 50,
      todayPrescribedLb: 50,
      rpe: 8,
      ageDays: 45,
    });
    expect(r).not.toBeNull();
    expect(r!.confidence).toBe("medium");
    expect(r!.lowLb).toBe(32.5);
    expect(r!.highLb).toBe(37.5);
  });
});
