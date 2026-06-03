// Converts a server-shaped `WorkoutDisplay` back into the client-side
// `WorkoutBuilderForm` shape used by SmartBuilder. Shared between the
// personal CrossFit edit flow and the gym programming track-day editor so
// editing a track-day workout pre-populates the builder instead of
// silently overwriting it.

import { formatSecondsAsClock } from "@/lib/crossfit/duration-parser";
import type {
  WorkoutBuilderForm,
  WorkoutBuilderMovement,
  WorkoutBuilderPart,
  WorkoutDisplay,
} from "@/types/crossfit";

function generateTempId() {
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function workoutToBuilderForm(w: WorkoutDisplay): WorkoutBuilderForm {
  // Pre-generate a tempId per part so weight_pct movements can map their
  // source-part DB id back to a builder tempRef (the builder works in
  // tempIds; the save path resolves them back to real ids).
  const partTempIds = w.parts.map(() => generateTempId());
  const tempIdByDbPartId = new Map(
    w.parts.map((p, i) => [p.id, partTempIds[i]])
  );
  return {
    title: w.title ?? "",
    description: w.description ?? "",
    workoutDate: w.workoutDate,
    benchmarkWorkoutId: w.benchmarkWorkoutId ?? null,
    requiresVest: !!w.requiresVest,
    vestWeightMaleLb:
      w.vestWeightMaleLb != null ? String(w.vestWeightMaleLb) : "",
    vestWeightFemaleLb:
      w.vestWeightFemaleLb != null ? String(w.vestWeightFemaleLb) : "",
    isPartner: !!w.isPartner,
    partnerCount: w.partnerCount != null ? String(w.partnerCount) : "",
    parts: w.parts.map((p, partIdx): WorkoutBuilderPart => {
      const blocks = (p.blocks ?? []).map((b) => ({
        tempId: generateTempId(),
        id: b.id,
        title: b.title,
        orderIndex: b.orderIndex,
      }));
      const blockTempRefByDbId = new Map(
        blocks.map((b) => [b.id ?? "", b.tempId])
      );
      return {
        tempId: partTempIds[partIdx],
        id: p.id,
        label: p.label ?? "",
        workoutType: p.workoutType,
        timeCapInput: p.timeCapSeconds
          ? formatSecondsAsClock(p.timeCapSeconds)
          : "",
        amrapDurationInput: p.amrapDurationSeconds
          ? formatSecondsAsClock(p.amrapDurationSeconds)
          : "",
        emomIntervalInput:
          p.emomIntervalSeconds != null
            ? formatSecondsAsClock(p.emomIntervalSeconds)
            : "",
        intervalWorkInput:
          p.intervalWorkSeconds != null
            ? formatSecondsAsClock(p.intervalWorkSeconds)
            : "",
        intervalRestInput:
          p.intervalRestSeconds != null
            ? formatSecondsAsClock(p.intervalRestSeconds)
            : "",
        intervalRounds:
          Array.isArray(p.intervalRounds) && p.intervalRounds.length > 0
            ? p.intervalRounds.map((r) => ({
                workInput: formatSecondsAsClock(r.workSeconds),
                restInput: formatSecondsAsClock(r.restSeconds),
              }))
            : undefined,
        sideCadenceIntervalInput:
          p.sideCadenceIntervalSeconds != null
            ? formatSecondsAsClock(p.sideCadenceIntervalSeconds)
            : "",
        sideCadenceOpenEnded: !!p.sideCadenceOpenEnded,
        repScheme: p.repScheme ?? "",
        rounds: p.rounds ? String(p.rounds) : "",
        structure: p.structure,
        scoreType: p.scoreType ?? undefined,
        movements: p.movements.map(
          (m): WorkoutBuilderMovement => ({
            tempId: generateTempId(),
            id: m.id,
            movementId: m.movementId,
            movementName: m.movementName,
            category: m.category,
            isWeighted: m.isWeighted,
            metricType: m.metricType,
            prescribedReps: m.prescribedReps ?? "",
            prescribedWeightMale: m.prescribedWeightMale ?? "",
            prescribedWeightFemale: m.prescribedWeightFemale ?? "",
            prescribedCaloriesMale:
              m.prescribedCaloriesMale != null
                ? String(m.prescribedCaloriesMale)
                : "",
            prescribedCaloriesFemale:
              m.prescribedCaloriesFemale != null
                ? String(m.prescribedCaloriesFemale)
                : "",
            prescribedDistanceMale:
              m.prescribedDistanceMale != null
                ? String(m.prescribedDistanceMale)
                : "",
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
            // weight_pct — re-anchor the source-part DB id to its builder
            // tempId so the picker resolves and the toggle starts on.
            prescribedWeightPct:
              m.prescribedWeightPct != null
                ? String(m.prescribedWeightPct)
                : "",
            useWeightPct: m.prescribedWeightPctSourcePartId != null,
            weightPctSourcePartTempRef: m.prescribedWeightPctSourcePartId
              ? tempIdByDbPartId.get(m.prescribedWeightPctSourcePartId) ??
                null
              : null,
            tempo: m.tempo ?? "",
            isMaxReps: !!m.isMaxReps,
            captureDurationPerRound: !!m.captureDurationPerRound,
            isSideCadence: !!m.isSideCadence,
            equipmentCount: m.equipmentCount,
            rxStandard: m.rxStandard ?? "",
            notes: m.notes ?? "",
            weightSource: m.weightSource ?? "prescribed",
            blockId: m.workoutBlockId ?? null,
            blockTempRef: m.workoutBlockId
              ? blockTempRefByDbId.get(m.workoutBlockId) ?? null
              : null,
          })
        ),
        blocks,
      };
    }),
  };
}
