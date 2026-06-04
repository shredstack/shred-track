"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useCreateRecoveryRoutine,
  useUpdateRecoveryRoutine,
} from "@/hooks/useRecoveryRoutines";
import { useActiveMembership, useGymContext } from "@/hooks/useGymContext";
import type { RecoveryPrescription } from "@/types/recovery";
import { MovementPicker } from "./movement-picker";
import { PrescriptionRow } from "./prescription-row";
import { BackButton } from "@/components/shared/back-button";

interface DraftMovement {
  key: string;
  movementId: string;
  movementName: string;
  isPerSide: boolean;
  prescription: RecoveryPrescription;
  notes: string;
}

let counter = 0;
const nextKey = () => `tmp-${Date.now()}-${counter++}`;

export interface RoutineBuilderInitial {
  id?: string;
  name: string;
  description: string;
  communityId: string | null;
  movements: DraftMovement[];
}

export function RoutineBuilderForm({
  initial,
}: {
  initial?: RoutineBuilderInitial;
}) {
  const router = useRouter();
  const create = useCreateRecoveryRoutine();
  const update = useUpdateRecoveryRoutine();
  const activeMembership = useActiveMembership();
  const { data: ctx } = useGymContext();

  const editing = !!initial?.id;

  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [scope, setScope] = useState<"personal" | "gym">(
    initial?.communityId ? "gym" : "personal"
  );
  const [movements, setMovements] = useState<DraftMovement[]>(
    initial?.movements ?? []
  );

  const isCoachOrAdmin = !!ctx?.memberships.some(
    (m) => m.isActive && (m.isAdmin || m.isCoach)
  );

  const move = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= movements.length) return;
    const next = [...movements];
    [next[idx], next[target]] = [next[target], next[idx]];
    setMovements(next);
  };

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Name required");
      return;
    }
    if (!movements.length) {
      toast.error("Add at least one movement");
      return;
    }
    const payload = {
      name: name.trim(),
      description: description || undefined,
      communityId:
        scope === "gym" && activeMembership
          ? activeMembership.communityId
          : null,
      movements: movements.map((m, i) => ({
        movementId: m.movementId,
        orderIndex: i,
        prescription: m.prescription,
        notes: m.notes || undefined,
      })),
    };

    try {
      if (editing && initial?.id) {
        await update.mutateAsync({ id: initial.id, data: payload });
        toast.success("Routine saved");
        router.push(`/recovery/routines/${initial.id}`);
      } else {
        const result = await create.mutateAsync(payload);
        toast.success("Routine created");
        router.push(`/recovery/routines/${result.id}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const submitting = create.isPending || update.isPending;

  return (
    <div className="flex flex-col gap-4">
      <BackButton
        fallbackHref={
          editing && initial?.id
            ? `/recovery/routines/${initial.id}`
            : "/recovery/routines"
        }
        label={editing ? "Routine" : "Routines"}
      />
      <h1 className="text-lg font-semibold">
        {editing ? "Edit routine" : "New routine"}
      </h1>

      <Card>
        <CardContent className="py-3 space-y-3">
          <div>
            <Label className="text-xs">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Shoulder reset"
            />
          </div>
          <div>
            <Label className="text-xs">Description (optional)</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {isCoachOrAdmin && activeMembership && !editing && (
            <div>
              <Label className="text-xs">Scope</Label>
              <div className="flex gap-2 mt-1">
                <button
                  onClick={() => setScope("personal")}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm ${scope === "personal" ? "border-primary bg-primary/10 text-primary" : "border-input"}`}
                >
                  Personal
                </button>
                <button
                  onClick={() => setScope("gym")}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm ${scope === "gym" ? "border-primary bg-primary/10 text-primary" : "border-input"}`}
                >
                  {activeMembership.communityName}
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-2">
        {movements.map((m, idx) => (
          <PrescriptionRow
            key={m.key}
            item={m}
            index={idx}
            total={movements.length}
            onMove={(dir) => move(idx, dir)}
            onRemove={() =>
              setMovements(movements.filter((x) => x.key !== m.key))
            }
            onPrescriptionChange={(next) =>
              setMovements(
                movements.map((x) =>
                  x.key === m.key ? { ...x, prescription: next } : x
                )
              )
            }
            onNotesChange={(notes) =>
              setMovements(
                movements.map((x) => (x.key === m.key ? { ...x, notes } : x))
              )
            }
          />
        ))}
        <MovementPicker
          includeRoutines={false}
          onAddMovement={(p) =>
            setMovements([
              ...movements,
              {
                key: nextKey(),
                movementId: p.movementId,
                movementName: p.movementName,
                isPerSide: p.isPerSide,
                prescription: { ...p.defaultPrescription },
                notes: "",
              },
            ])
          }
        />
      </div>

      <Button onClick={submit} disabled={submitting}>
        {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        {editing ? "Save changes" : "Create routine"}
      </Button>
    </div>
  );
}
