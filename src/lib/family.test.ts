// Pure-function tests for the dependents helpers. DB-bound logic
// (createShadowDependent, mergeShadowIntoUser, etc.) needs integration
// tests against Postgres — this codebase doesn't have an integration
// harness yet, so this file covers only the math/string functions.
//
// Spec §7 PR 1 tests calls for "isMinor correctly handles the gym-tz
// boundary at midnight" — that's the main case we exercise here.

import { describe, expect, it, vi, afterEach } from "vitest";
import {
  ageInGymTz,
  generateShadowEmail,
  generateToken,
  isMinor,
  isShadowEmail,
} from "./family";

afterEach(() => {
  vi.useRealTimers();
});

describe("isMinor", () => {
  it("returns false when dateOfBirth is null", () => {
    expect(isMinor(null, "UTC")).toBe(false);
  });

  it("returns true for a 10-year-old", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-05-20T12:00:00Z"));
    expect(isMinor("2016-01-01", "America/Denver")).toBe(true);
  });

  it("returns false for a 30-year-old", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-05-20T12:00:00Z"));
    expect(isMinor("1996-01-01", "America/Denver")).toBe(false);
  });

  it("handles the eighteenth-birthday boundary in the gym's timezone", () => {
    // Subject was born 2008-01-15. Their 18th birthday is 2026-01-15.
    // At 2026-01-15T00:30:00Z, Denver is still on 2026-01-14 (UTC-7).
    // They should still be a minor under Denver's clock.
    vi.useFakeTimers().setSystemTime(new Date("2026-01-15T00:30:00Z"));
    expect(isMinor("2008-01-15", "America/Denver")).toBe(true);

    // Same instant, evaluated against UTC: they are 18 — not a minor.
    expect(isMinor("2008-01-15", "UTC")).toBe(false);
  });

  it("returns false the morning after the 18th birthday", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-01-15T18:00:00Z"));
    expect(isMinor("2008-01-15", "America/Denver")).toBe(false);
  });

  it("gracefully handles an invalid date string", () => {
    expect(isMinor("not-a-date", "UTC")).toBe(false);
  });
});

describe("ageInGymTz", () => {
  it("returns null for null DOB", () => {
    expect(ageInGymTz(null, "UTC")).toBeNull();
  });

  it("computes age before and after the birthday in the same year", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-05-20T12:00:00Z"));
    // Day before birthday: still 35.
    expect(ageInGymTz("1990-05-21", "America/Denver")).toBe(35);
    // On birthday: now 36.
    expect(ageInGymTz("1990-05-20", "America/Denver")).toBe(36);
  });
});

describe("shadow email helpers", () => {
  it("generateShadowEmail returns the synthetic shadow domain", () => {
    const email = generateShadowEmail();
    expect(email).toMatch(/^shadow\+[0-9a-f]{8}@shredtrack-shadow\.local$/);
  });

  it("isShadowEmail recognizes synthetic addresses", () => {
    const synthetic = generateShadowEmail();
    expect(isShadowEmail(synthetic)).toBe(true);
    expect(isShadowEmail("real@example.com")).toBe(false);
    expect(isShadowEmail(null)).toBe(false);
    expect(isShadowEmail(undefined)).toBe(false);
  });

  it("recognizes merged-shadow addresses too", () => {
    // softDeleteShadowDependent rewrites to this form.
    const merged = "shadow-merged-abc123@shredtrack-shadow.local";
    expect(isShadowEmail(merged)).toBe(true);
  });
});

describe("generateToken", () => {
  it("returns a URL-safe high-entropy string with no dashes", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
  });
});
