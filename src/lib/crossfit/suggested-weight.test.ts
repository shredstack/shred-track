import { describe, expect, it } from "vitest";
import { roundToPlate } from "./suggested-weight";

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
