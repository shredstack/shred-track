// Maps a WorkoutBuilderPart (the form-side, all-strings shape) to the
// CreatePartInput payload the workouts/benchmarks APIs accept. Shared
// between the workouts builder, the user-facing benchmark form, and the
// admin benchmark form so the three callers can't drift apart on which
// fields make it across the wire.

import type { CreatePartInput } from "@/hooks/useWorkouts";
import type {
  BenchmarkWorkoutPart,
  WorkoutBuilderMovement,
  WorkoutBuilderPart,
} from "@/types/crossfit";
import {
  formatSecondsAsClock,
  parseDurationToSeconds,
} from "@/lib/crossfit/duration-parser";

function generateTempId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Convert a BenchmarkWorkoutPart (server shape, typed values) into the
// WorkoutBuilderPart shape the form drives (all strings, tempIds, etc.).
// Shared by the user-facing benchmark form and the admin form so editing
// flows render the same way everywhere.
export function benchmarkPartToBuilderPart(
  part: BenchmarkWorkoutPart
): WorkoutBuilderPart {
  const blocks = (part.blocks ?? []).map((b) => ({
    tempId: generateTempId("block"),
    id: b.id,
    title: b.title,
    orderIndex: b.orderIndex,
  }));
  const blockTempByDbId = new Map(blocks.map((b) => [b.id ?? "", b.tempId]));
  return {
    tempId: generateTempId("part"),
    // Synthetic ids (legacy single-part backfill) shouldn't round-trip as a
    // real part id; the API ignores `synthetic:*` ids and inserts new rows.
    id:
      part.id && !part.id.startsWith("synthetic:") ? part.id : undefined,
    label: part.label ?? "",
    workoutType: part.workoutType,
    timeCapInput: part.timeCapSeconds
      ? formatSecondsAsClock(part.timeCapSeconds)
      : "",
    amrapDurationInput: part.amrapDurationSeconds
      ? formatSecondsAsClock(part.amrapDurationSeconds)
      : "",
    emomIntervalInput:
      part.emomIntervalSeconds != null
        ? formatSecondsAsClock(part.emomIntervalSeconds)
        : "",
    intervalWorkInput:
      part.intervalWorkSeconds != null
        ? formatSecondsAsClock(part.intervalWorkSeconds)
        : "",
    intervalRestInput:
      part.intervalRestSeconds != null
        ? formatSecondsAsClock(part.intervalRestSeconds)
        : "",
    intervalRounds:
      Array.isArray(part.intervalRounds) && part.intervalRounds.length > 0
        ? part.intervalRounds.map((r) => ({
            workInput: formatSecondsAsClock(r.workSeconds),
            restInput: formatSecondsAsClock(r.restSeconds),
          }))
        : undefined,
    sideCadenceIntervalInput:
      part.sideCadenceIntervalSeconds != null
        ? formatSecondsAsClock(part.sideCadenceIntervalSeconds)
        : "",
    sideCadenceOpenEnded: part.sideCadenceOpenEnded,
    repScheme: part.repScheme ?? "",
    rounds: part.rounds != null ? String(part.rounds) : "",
    structure: part.structure ?? undefined,
    movements: part.movements.map((m): WorkoutBuilderMovement => {
      const isWeighted =
        m.isWeighted ??
        !!(m.prescribedWeightMale || m.prescribedWeightFemale);
      const metricType = m.metricType ?? (isWeighted ? "weight" : "reps");
      return {
        tempId: generateTempId("mov"),
        id: m.id,
        movementId: m.movementId,
        movementName: m.movementName,
        category: m.category,
        isWeighted,
        metricType,
        prescribedReps: m.prescribedReps ?? "",
        prescribedWeightMale:
          m.prescribedWeightMale != null
            ? String(m.prescribedWeightMale)
            : "",
        prescribedWeightFemale:
          m.prescribedWeightFemale != null
            ? String(m.prescribedWeightFemale)
            : "",
        prescribedCaloriesMale:
          m.prescribedCaloriesMale != null ? String(m.prescribedCaloriesMale) : "",
        prescribedCaloriesFemale:
          m.prescribedCaloriesFemale != null
            ? String(m.prescribedCaloriesFemale)
            : "",
        prescribedDistanceMale:
          m.prescribedDistanceMale != null ? String(m.prescribedDistanceMale) : "",
        prescribedDistanceFemale:
          m.prescribedDistanceFemale != null
            ? String(m.prescribedDistanceFemale)
            : "",
        prescribedDurationSecondsMale:
          m.prescribedDurationSecondsMale != null
            ? String(m.prescribedDurationSecondsMale)
            : "",
        prescribedDurationSecondsFemale:
          m.prescribedDurationSecondsFemale != null
            ? String(m.prescribedDurationSecondsFemale)
            : "",
        prescribedHeightInches:
          m.prescribedHeightInches != null
            ? String(m.prescribedHeightInches)
            : "",
        prescribedHeightInchesMale:
          m.prescribedHeightInchesMale != null
            ? String(m.prescribedHeightInchesMale)
            : "",
        prescribedHeightInchesFemale:
          m.prescribedHeightInchesFemale != null
            ? String(m.prescribedHeightInchesFemale)
            : "",
        useBwMultiplier:
          m.prescribedWeightMaleBwMultiplier != null ||
          m.prescribedWeightFemaleBwMultiplier != null,
        prescribedWeightMaleBwMultiplier:
          m.prescribedWeightMaleBwMultiplier != null
            ? String(m.prescribedWeightMaleBwMultiplier)
            : "",
        prescribedWeightFemaleBwMultiplier:
          m.prescribedWeightFemaleBwMultiplier != null
            ? String(m.prescribedWeightFemaleBwMultiplier)
            : "",
        tempo: m.tempo ?? "",
        isMaxReps: !!m.isMaxReps,
        isSideCadence: !!m.isSideCadence,
        equipmentCount: m.equipmentCount ?? undefined,
        rxStandard: m.rxStandard ?? "",
        notes: m.notes ?? "",
        blockId: m.blockId ?? null,
        blockTempRef: m.blockId ? blockTempByDbId.get(m.blockId) ?? null : null,
      };
    }),
    blocks,
  };
}

export function builderPartToPayload(
  part: WorkoutBuilderPart
): CreatePartInput | null {
  const movements = part.movements.filter((m) => m.movementId);
  if (movements.length === 0) return null;
  // for_load parts: weight IS the score, so any prescribed weight values
  // are phantom defaults (auto-filled from movement library commonRx) that
  // the builder hides from the UI but still carries in state.
  const stripRxWeights = part.workoutType === "for_load";
  return {
    id: part.id,
    label: part.label || undefined,
    workoutType: part.workoutType,
    timeCapSeconds: parseDurationToSeconds(part.timeCapInput) ?? undefined,
    amrapDurationSeconds:
      parseDurationToSeconds(part.amrapDurationInput) ?? undefined,
    emomIntervalSeconds:
      parseDurationToSeconds(part.emomIntervalInput) ?? undefined,
    intervalWorkSeconds: part.intervalWorkInput || undefined,
    intervalRestSeconds: part.intervalRestInput || undefined,
    intervalRounds:
      part.workoutType === "intervals" &&
      part.intervalRounds &&
      part.intervalRounds.length > 0 &&
      part.intervalRounds.some(
        (r) => r.workInput.trim() || r.restInput.trim()
      )
        ? part.intervalRounds.map((r) => ({
            workSeconds: r.workInput,
            restSeconds: r.restInput,
          }))
        : undefined,
    sideCadenceIntervalSeconds: part.sideCadenceIntervalInput || undefined,
    sideCadenceOpenEnded: !!part.sideCadenceOpenEnded,
    repScheme: part.repScheme || undefined,
    rounds:
      (part.workoutType === "for_time" || part.workoutType === "intervals") &&
      part.rounds
        ? parseInt(part.rounds)
        : undefined,
    structure:
      part.workoutType === "for_reps" && part.structure
        ? part.structure
        : undefined,
    movements: movements.map((m, i) => ({
      id: m.id,
      movementId: m.movementId!,
      orderIndex: i,
      prescribedReps: m.prescribedReps || undefined,
      prescribedWeightMale:
        !stripRxWeights && !m.useBwMultiplier && m.prescribedWeightMale
          ? parseFloat(m.prescribedWeightMale)
          : undefined,
      prescribedWeightFemale:
        !stripRxWeights && !m.useBwMultiplier && m.prescribedWeightFemale
          ? parseFloat(m.prescribedWeightFemale)
          : undefined,
      prescribedCaloriesMale: m.prescribedCaloriesMale || undefined,
      prescribedCaloriesFemale: m.prescribedCaloriesFemale || undefined,
      prescribedDistanceMale: m.prescribedDistanceMale || undefined,
      prescribedDistanceFemale: m.prescribedDistanceFemale || undefined,
      prescribedDurationSecondsMale:
        m.prescribedDurationSecondsMale?.trim() || undefined,
      prescribedDurationSecondsFemale:
        m.prescribedDurationSecondsFemale?.trim() || undefined,
      prescribedHeightInches: m.prescribedHeightInches || undefined,
      prescribedHeightInchesMale: m.prescribedHeightInchesMale || undefined,
      prescribedHeightInchesFemale:
        m.prescribedHeightInchesFemale || undefined,
      prescribedWeightMaleBwMultiplier:
        !stripRxWeights &&
        m.useBwMultiplier &&
        m.prescribedWeightMaleBwMultiplier
          ? parseFloat(m.prescribedWeightMaleBwMultiplier)
          : undefined,
      prescribedWeightFemaleBwMultiplier:
        !stripRxWeights &&
        m.useBwMultiplier &&
        m.prescribedWeightFemaleBwMultiplier
          ? parseFloat(m.prescribedWeightFemaleBwMultiplier)
          : undefined,
      tempo: m.tempo?.trim() || undefined,
      isMaxReps: !!m.isMaxReps,
      isSideCadence: !!m.isSideCadence,
      promoteSequenceToLadder: m.promoteSequenceToLadder || undefined,
      equipmentCount: m.equipmentCount,
      rxStandard: m.rxStandard || undefined,
      blockId: m.blockId ?? null,
      blockTempRef: m.blockTempRef ?? null,
    })),
    blocks:
      part.blocks.length > 0
        ? part.blocks.map((b, i) => ({
            id: b.id,
            tempRef: b.tempId,
            title: b.title,
            orderIndex: b.orderIndex ?? i,
          }))
        : undefined,
  };
}
