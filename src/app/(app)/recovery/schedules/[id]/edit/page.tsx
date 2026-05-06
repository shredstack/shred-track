"use client";

import { use } from "react";
import { Loader2 } from "lucide-react";
import { useRecoverySchedule } from "@/hooks/useRecoverySchedules";
import { ScheduleBuilderForm } from "@/components/recovery/schedule-builder-form";
import type { RecoveryPrescription } from "@/types/recovery";

let counter = 0;
const nextKey = () => `existing-${counter++}`;

export default function EditSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, isLoading } = useRecoverySchedule(id);

  if (isLoading || !data) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const slots = data.slots ?? [];

  // Bucket slots into per-day arrays for day-keyed schedules; for
  // frequency-keyed, all slots share dayIndex = null.
  const rotationDays = data.rotationDays ?? 3;
  const daySlots: ReturnType<typeof toDraftSlot>[][] = Array.from(
    { length: rotationDays },
    () => []
  );
  const freqSlots: ReturnType<typeof toDraftSlot>[] = [];
  for (const s of slots) {
    const draft = toDraftSlot(s);
    if (data.kind === "day_keyed" && s.dayIndex) {
      const idx = s.dayIndex - 1;
      if (idx >= 0 && idx < daySlots.length) daySlots[idx].push(draft);
    } else {
      freqSlots.push(draft);
    }
  }

  return (
    <ScheduleBuilderForm
      initial={{
        id: data.id,
        name: data.name,
        description: data.description ?? "",
        kind: data.kind,
        rotationDays,
        weeklyTarget: data.weeklyTarget ?? 2,
        communityId: data.communityId ?? null,
        daySlots,
        freqSlots,
      }}
    />
  );
}

function toDraftSlot(s: {
  movementId?: string | null;
  movementName?: string;
  isPerSide?: boolean;
  routineId?: string | null;
  routineName?: string;
  prescription?: unknown;
  notes?: string | null;
}) {
  return {
    key: nextKey(),
    movementId: s.movementId ?? undefined,
    movementName: s.movementName,
    isPerSide: s.isPerSide,
    routineId: s.routineId ?? undefined,
    routineName: s.routineName,
    prescription: (s.prescription as RecoveryPrescription) ?? {},
    notes: s.notes ?? "",
  };
}
