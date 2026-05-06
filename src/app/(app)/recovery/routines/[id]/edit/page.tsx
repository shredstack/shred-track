"use client";

import { use } from "react";
import { Loader2 } from "lucide-react";
import { useRecoveryRoutine } from "@/hooks/useRecoveryRoutines";
import { RoutineBuilderForm } from "@/components/recovery/routine-builder-form";
import type { RecoveryPrescription } from "@/types/recovery";

let counter = 0;
const nextKey = () => `existing-${counter++}`;

export default function EditRoutinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, isLoading } = useRecoveryRoutine(id);

  if (isLoading || !data) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <RoutineBuilderForm
      initial={{
        id: data.id,
        name: data.name,
        description: data.description ?? "",
        communityId: data.communityId ?? null,
        movements: (data.movements ?? []).map((m) => ({
          key: nextKey(),
          movementId: m.movementId,
          movementName: m.movementName ?? "Movement",
          isPerSide: m.isPerSide ?? false,
          prescription: (m.prescription as RecoveryPrescription) ?? {},
          notes: m.notes ?? "",
        })),
      }}
    />
  );
}
