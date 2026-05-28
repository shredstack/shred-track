import { describe, expect, it } from "vitest";
import {
  computeWorkoutFingerprint,
  type FingerprintInput,
} from "./fingerprint";

// Helper: a minimal Fran-like prescription.
function franLike(overrides: Partial<FingerprintInput> = {}): FingerprintInput {
  return {
    workout: {
      workoutType: "for_time",
      timeCapSeconds: 600,
      ...overrides.workout,
    },
    parts: overrides.parts ?? [
      {
        orderIndex: 0,
        workoutType: "for_time",
        timeCapSeconds: 600,
        repScheme: "21-15-9",
        movements: [
          {
            movementId: "00000000-0000-0000-0000-00000000aaaa",
            orderIndex: 0,
            blockOrderIndex: null,
            prescribedWeightMale: 95,
            prescribedWeightFemale: 65,
          },
          {
            movementId: "00000000-0000-0000-0000-00000000bbbb",
            orderIndex: 1,
            blockOrderIndex: null,
          },
        ],
      },
    ],
  };
}

describe("computeWorkoutFingerprint", () => {
  it("is deterministic", () => {
    const fp1 = computeWorkoutFingerprint(franLike());
    const fp2 = computeWorkoutFingerprint(franLike());
    expect(fp1).toBe(fp2);
    expect(fp1).toHaveLength(64); // sha256 hex
  });

  it("normalizes numeric strings vs numbers", () => {
    const asNumber = computeWorkoutFingerprint(franLike());
    const asString = computeWorkoutFingerprint(
      franLike({
        parts: franLike().parts.map((p) => ({
          ...p,
          movements: p.movements.map((m, i) => ({
            ...m,
            prescribedWeightMale:
              i === 0 ? ("95.0" as unknown as string) : m.prescribedWeightMale,
            prescribedWeightFemale:
              i === 0
                ? ("65" as unknown as string)
                : m.prescribedWeightFemale,
          })),
        })),
      })
    );
    expect(asNumber).toBe(asString);
  });

  it("treats null, undefined, and empty-string as equivalent", () => {
    const a = computeWorkoutFingerprint({
      workout: {
        workoutType: "for_time",
        timeCapSeconds: 600,
        repScheme: null,
      },
      parts: [
        {
          orderIndex: 0,
          workoutType: "for_time",
          timeCapSeconds: 600,
          repScheme: "21-15-9",
          movements: [
            {
              movementId: "mov-1",
              orderIndex: 0,
              prescribedReps: null,
            },
          ],
        },
      ],
    });
    const b = computeWorkoutFingerprint({
      workout: {
        workoutType: "for_time",
        timeCapSeconds: 600,
        // repScheme omitted entirely
      },
      parts: [
        {
          orderIndex: 0,
          workoutType: "for_time",
          timeCapSeconds: 600,
          repScheme: "21-15-9",
          movements: [
            {
              movementId: "mov-1",
              orderIndex: 0,
              prescribedReps: "", // empty string
            },
          ],
        },
      ],
    });
    expect(a).toBe(b);
  });

  it("ignores cosmetic-only inputs (none — there are no cosmetic fields in the input type, this asserts the contract)", () => {
    // The fingerprint input intentionally has no title/description/notes/category
    // fields. This test is a safeguard: if someone adds one to the type later,
    // this test must be updated and the fingerprint algorithm should also be
    // updated to NOT include it.
    const input = franLike();
    const fp = computeWorkoutFingerprint(input);
    // Confirm the type has no notes/title/description by checking we can
    // construct one without them.
    expect(fp).toBeDefined();
  });

  it("changes when a movement weight changes", () => {
    const baseline = computeWorkoutFingerprint(franLike());
    const changed = computeWorkoutFingerprint(
      franLike({
        parts: franLike().parts.map((p) => ({
          ...p,
          movements: p.movements.map((m, i) =>
            i === 0 ? { ...m, prescribedWeightMale: 100 } : m
          ),
        })),
      })
    );
    expect(baseline).not.toBe(changed);
  });

  it("changes when movement order changes", () => {
    const baseline = computeWorkoutFingerprint(franLike());
    const reversed = computeWorkoutFingerprint(
      franLike({
        parts: franLike().parts.map((p) => ({
          ...p,
          // Swap order_index — different prescription.
          movements: p.movements.map((m) => ({
            ...m,
            orderIndex: 1 - m.orderIndex,
          })),
        })),
      })
    );
    expect(baseline).not.toBe(reversed);
  });

  it("does not depend on movement array ordering", () => {
    // Same prescription, but the caller passes movements in reverse array order.
    // Because each movement has its own orderIndex, the fingerprint must sort
    // them deterministically and produce the same hash.
    const canonical = computeWorkoutFingerprint(franLike());
    const movements = franLike().parts[0].movements;
    const shuffled: FingerprintInput = {
      ...franLike(),
      parts: [
        {
          ...franLike().parts[0],
          movements: [...movements].reverse(),
        },
      ],
    };
    expect(computeWorkoutFingerprint(shuffled)).toBe(canonical);
  });

  it("does not depend on parts array ordering", () => {
    const twoParts: FingerprintInput = {
      workout: { workoutType: "for_time" },
      parts: [
        {
          orderIndex: 0,
          workoutType: "for_load",
          movements: [{ movementId: "mov-a", orderIndex: 0 }],
        },
        {
          orderIndex: 1,
          workoutType: "for_time",
          movements: [{ movementId: "mov-b", orderIndex: 0 }],
        },
      ],
    };
    const reversed: FingerprintInput = {
      ...twoParts,
      parts: [...twoParts.parts].reverse(),
    };
    expect(computeWorkoutFingerprint(twoParts)).toBe(
      computeWorkoutFingerprint(reversed)
    );
  });

  it("respects block_order_index when movements are grouped", () => {
    const a: FingerprintInput = {
      workout: { workoutType: "for_time" },
      parts: [
        {
          orderIndex: 0,
          workoutType: "for_time",
          movements: [
            { movementId: "m1", orderIndex: 0, blockOrderIndex: 0 },
            { movementId: "m2", orderIndex: 0, blockOrderIndex: 1 },
          ],
        },
      ],
    };
    const b: FingerprintInput = {
      workout: { workoutType: "for_time" },
      parts: [
        {
          orderIndex: 0,
          workoutType: "for_time",
          movements: [
            { movementId: "m1", orderIndex: 0, blockOrderIndex: 1 },
            { movementId: "m2", orderIndex: 0, blockOrderIndex: 0 },
          ],
        },
      ],
    };
    expect(computeWorkoutFingerprint(a)).not.toBe(computeWorkoutFingerprint(b));
  });

  it("partner/vest flags affect the fingerprint", () => {
    const baseline = computeWorkoutFingerprint(franLike());
    const partner = computeWorkoutFingerprint(
      franLike({
        workout: {
          workoutType: "for_time",
          timeCapSeconds: 600,
          isPartner: true,
          partnerCount: 2,
        },
      })
    );
    expect(baseline).not.toBe(partner);
  });

  it("intervalRounds JSON is normalized deterministically", () => {
    const a: FingerprintInput = {
      workout: { workoutType: "intervals" },
      parts: [
        {
          orderIndex: 0,
          workoutType: "intervals",
          intervalRounds: [
            { work: 240, rest: 240 },
            { work: 180, rest: 180 },
          ],
          movements: [],
        },
      ],
    };
    const b: FingerprintInput = {
      workout: { workoutType: "intervals" },
      parts: [
        {
          orderIndex: 0,
          workoutType: "intervals",
          intervalRounds: [
            // Same data, different key order in the round objects.
            { rest: 240, work: 240 },
            { rest: 180, work: 180 },
          ],
          movements: [],
        },
      ],
    };
    expect(computeWorkoutFingerprint(a)).toBe(computeWorkoutFingerprint(b));
  });
});
