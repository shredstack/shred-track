import { describe, it, expect } from "vitest";
import { bandFor, estimatedOneRmForSet } from "./predicted-1rm";

// ============================================
// Confidence band — keyed to distinct sessions
// ============================================

describe("bandFor", () => {
  it("gives a single session the widest band (rough estimate)", () => {
    expect(bandFor(1)).toBe(15);
  });

  it("does not tighten the band for a single multi-set session", () => {
    // Five sets logged on one day are correlated — they must still read as
    // one session, not earn the ±6% band that five distinct sessions would.
    expect(bandFor(1)).toBe(15);
  });

  it("tightens as distinct sessions accumulate", () => {
    expect(bandFor(2)).toBe(10);
    expect(bandFor(3)).toBe(6);
    expect(bandFor(4)).toBe(6);
    expect(bandFor(5)).toBe(4);
    expect(bandFor(9)).toBe(4);
  });

  it("is monotonically non-increasing in session count", () => {
    let prev = Infinity;
    for (let n = 1; n <= 12; n++) {
      const band = bandFor(n);
      expect(band).toBeLessThanOrEqual(prev);
      prev = band;
    }
  });
});

// ============================================
// Per-set e1RM
// ============================================

describe("estimatedOneRmForSet", () => {
  it("returns the weight itself for a single rep", () => {
    expect(estimatedOneRmForSet(225, 1)).toBe(225);
  });

  it("returns 0 for non-positive weight or reps", () => {
    expect(estimatedOneRmForSet(0, 5)).toBe(0);
    expect(estimatedOneRmForSet(135, 0)).toBe(0);
  });

  it("estimates above the lifted weight for multi-rep sets", () => {
    // 5 strict presses at 67.5 lb — Brzycki 75.9, Epley 78.75, take the max.
    const e1rm = estimatedOneRmForSet(67.5, 5);
    expect(e1rm).toBeGreaterThan(67.5);
    expect(e1rm).toBeCloseTo(78.75, 2);
  });
});
