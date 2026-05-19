// Lightweight test of the inline-track-injection contract (spec §2.1).
// Full integration coverage requires a real Postgres connection; this
// file pins the public contract (exports + signature) so a downstream
// rename catches the test failure.

import { describe, expect, it } from "vitest";
import { injectInlineTrackSections } from "@/lib/programming/inline-track-injection";

describe("inline-track-injection module surface", () => {
  it("exports a callable injectInlineTrackSections", () => {
    expect(typeof injectInlineTrackSections).toBe("function");
  });

  it("returns a thenable when invoked (function returns a Promise)", () => {
    // Don't actually await — the inner call will hit `db`. We just check
    // the function signature returns a Promise-like value, which catches
    // accidental sync rewrites.
    const result = (
      injectInlineTrackSections as unknown as (
        opts: unknown
      ) => Promise<unknown>
    )({ communityId: "00000000-0000-0000-0000-000000000000", weekStart: "2026-06-01" });
    expect(typeof (result as unknown as { catch?: unknown }).catch).toBe(
      "function"
    );
    // Catch so the test doesn't fail on the pending DB call.
    (result as Promise<unknown>).catch(() => undefined);
  });
});
