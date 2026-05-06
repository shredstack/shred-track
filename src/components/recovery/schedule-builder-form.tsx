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
  useCreateRecoverySchedule,
  useUpdateRecoverySchedule,
} from "@/hooks/useRecoverySchedules";
import { useActiveMembership, useGymContext } from "@/hooks/useGymContext";
import type {
  RecoveryPrescription,
  RecoveryScheduleKind,
} from "@/types/recovery";
import { MovementPicker } from "./movement-picker";
import { PrescriptionRow } from "./prescription-row";

interface DraftSlot {
  key: string;
  movementId?: string;
  movementName?: string;
  routineId?: string;
  routineName?: string;
  isPerSide?: boolean;
  prescription: RecoveryPrescription;
  notes: string;
}

interface DraftDay {
  dayIndex: number;
  slots: DraftSlot[];
}

let counter = 0;
const nextKey = () => `tmp-${Date.now()}-${counter++}`;

export interface ScheduleBuilderInitial {
  id?: string;
  name: string;
  description: string;
  kind: RecoveryScheduleKind;
  rotationDays: number;
  weeklyTarget: number;
  communityId: string | null;
  daySlots: DraftSlot[][]; // index = dayIndex - 1
  freqSlots: DraftSlot[];
}

export function ScheduleBuilderForm({
  initial,
}: {
  initial?: ScheduleBuilderInitial;
}) {
  const router = useRouter();
  const create = useCreateRecoverySchedule();
  const update = useUpdateRecoverySchedule();
  const activeMembership = useActiveMembership();
  const { data: ctx } = useGymContext();

  const editing = !!initial?.id;

  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [kind, setKind] = useState<RecoveryScheduleKind>(
    initial?.kind ?? "day_keyed"
  );
  const [rotationDays, setRotationDays] = useState(initial?.rotationDays ?? 3);
  const [weeklyTarget, setWeeklyTarget] = useState(initial?.weeklyTarget ?? 2);
  const [scope, setScope] = useState<"personal" | "gym">(
    initial?.communityId ? "gym" : "personal"
  );
  const [activeDay, setActiveDay] = useState(1);

  const initDays = (count: number, prefill?: DraftSlot[][]): DraftDay[] =>
    Array.from({ length: count }, (_, i) => ({
      dayIndex: i + 1,
      slots: prefill?.[i] ?? [],
    }));

  const [days, setDays] = useState<DraftDay[]>(
    initDays(initial?.rotationDays ?? 3, initial?.daySlots)
  );
  const [freqSlots, setFreqSlots] = useState<DraftSlot[]>(
    initial?.freqSlots ?? []
  );

  const isCoachOrAdmin = !!ctx?.memberships.some(
    (m) => m.isActive && (m.isAdmin || m.isCoach)
  );

  const updateRotationDays = (n: number) => {
    setRotationDays(n);
    setDays((prev) => {
      if (n > prev.length) {
        const additions = Array.from({ length: n - prev.length }, (_, i) => ({
          dayIndex: prev.length + i + 1,
          slots: [] as DraftSlot[],
        }));
        return [...prev, ...additions];
      }
      return prev.slice(0, n);
    });
    if (activeDay > n) setActiveDay(n);
  };

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Name required");
      return;
    }

    const slots =
      kind === "day_keyed"
        ? days.flatMap((d) =>
            d.slots.map((s, i) => ({
              dayIndex: d.dayIndex,
              orderIndex: i,
              movementId: s.movementId ?? null,
              routineId: s.routineId ?? null,
              prescription: s.prescription,
              notes: s.notes || null,
            }))
          )
        : freqSlots.map((s, i) => ({
            dayIndex: null,
            orderIndex: i,
            movementId: s.movementId ?? null,
            routineId: s.routineId ?? null,
            prescription: s.prescription,
            notes: s.notes || null,
          }));

    if (!slots.length) {
      toast.error("Add at least one movement");
      return;
    }

    try {
      if (editing && initial?.id) {
        await update.mutateAsync({
          id: initial.id,
          data: {
            name: name.trim(),
            description: description || undefined,
            rotationDays: kind === "day_keyed" ? rotationDays : undefined,
            weeklyTarget: kind === "frequency_keyed" ? weeklyTarget : undefined,
            slots,
          },
        });
        toast.success("Schedule saved");
        router.push(`/recovery/schedules/${initial.id}`);
      } else {
        const result = await create.mutateAsync({
          name: name.trim(),
          kind,
          rotationDays: kind === "day_keyed" ? rotationDays : undefined,
          weeklyTarget: kind === "frequency_keyed" ? weeklyTarget : undefined,
          description: description || undefined,
          communityId:
            scope === "gym" && activeMembership
              ? activeMembership.communityId
              : null,
          slots,
        });
        toast.success("Schedule created");
        router.push(`/recovery/schedules/${result.id}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const currentSlots: DraftSlot[] =
    kind === "day_keyed"
      ? days.find((d) => d.dayIndex === activeDay)?.slots ?? []
      : freqSlots;

  const updateSlots = (next: DraftSlot[]) => {
    if (kind === "day_keyed") {
      setDays((prev) =>
        prev.map((d) =>
          d.dayIndex === activeDay ? { ...d, slots: next } : d
        )
      );
    } else {
      setFreqSlots(next);
    }
  };

  const move = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= currentSlots.length) return;
    const next = [...currentSlots];
    [next[idx], next[target]] = [next[target], next[idx]];
    updateSlots(next);
  };

  const submitting = create.isPending || update.isPending;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">
        {editing ? "Edit schedule" : "New schedule"}
      </h1>

      <Card>
        <CardContent className="py-3 space-y-3">
          <div>
            <Label className="text-xs">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Hip mobility — 3 day rotation"
            />
          </div>
          <div>
            <Label className="text-xs">Description (optional)</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {!editing && (
            <div>
              <Label className="text-xs">Type</Label>
              <div className="flex gap-2 mt-1">
                <button
                  onClick={() => setKind("day_keyed")}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm ${kind === "day_keyed" ? "border-primary bg-primary/10 text-primary" : "border-input"}`}
                >
                  Day rotation
                </button>
                <button
                  onClick={() => setKind("frequency_keyed")}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm ${kind === "frequency_keyed" ? "border-primary bg-primary/10 text-primary" : "border-input"}`}
                >
                  X × per week
                </button>
              </div>
            </div>
          )}
          {kind === "day_keyed" ? (
            <div>
              <Label className="text-xs">Rotation days</Label>
              <Input
                type="number"
                min={1}
                max={14}
                value={rotationDays}
                onChange={(e) =>
                  updateRotationDays(
                    Math.max(1, Math.min(14, Number(e.target.value) || 1))
                  )
                }
              />
            </div>
          ) : (
            <div>
              <Label className="text-xs">Sessions per week</Label>
              <Input
                type="number"
                min={1}
                max={7}
                value={weeklyTarget}
                onChange={(e) =>
                  setWeeklyTarget(
                    Math.max(1, Math.min(7, Number(e.target.value) || 1))
                  )
                }
              />
            </div>
          )}
          {!editing && isCoachOrAdmin && activeMembership && (
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

      {kind === "day_keyed" && (
        <div className="flex gap-1 overflow-x-auto -mx-1 px-1">
          {days.map((d) => (
            <button
              key={d.dayIndex}
              onClick={() => setActiveDay(d.dayIndex)}
              className={`shrink-0 rounded-md border px-3 py-1.5 text-xs ${activeDay === d.dayIndex ? "border-primary bg-primary/10 text-primary" : "border-input"}`}
            >
              Day {d.dayIndex} ({d.slots.length})
            </button>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {currentSlots.map((s, idx) => (
          <PrescriptionRow
            key={s.key}
            item={{ ...s, isRoutine: !!s.routineId }}
            index={idx}
            total={currentSlots.length}
            onMove={(dir) => move(idx, dir)}
            onRemove={() =>
              updateSlots(currentSlots.filter((x) => x.key !== s.key))
            }
            onPrescriptionChange={(next) =>
              updateSlots(
                currentSlots.map((x) =>
                  x.key === s.key ? { ...x, prescription: next } : x
                )
              )
            }
            onNotesChange={(notes) =>
              updateSlots(
                currentSlots.map((x) =>
                  x.key === s.key ? { ...x, notes } : x
                )
              )
            }
            showPrescriptionInputs={!s.routineId}
          />
        ))}
        <MovementPicker
          includeRoutines
          onAddMovement={(p) =>
            updateSlots([
              ...currentSlots,
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
          onAddRoutine={(p) =>
            updateSlots([
              ...currentSlots,
              {
                key: nextKey(),
                routineId: p.routineId,
                routineName: p.routineName,
                prescription: {},
                notes: "",
              },
            ])
          }
        />
      </div>

      <Button onClick={submit} disabled={submitting}>
        {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        {editing ? "Save changes" : "Save schedule"}
      </Button>
    </div>
  );
}
