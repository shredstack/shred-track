"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useRecoveryMovements } from "@/hooks/useRecoveryMovements";
import { useRecoveryRoutines } from "@/hooks/useRecoveryRoutines";
import { useCreateRecoverySchedule } from "@/hooks/useRecoverySchedules";
import { useActiveMembership, useGymContext } from "@/hooks/useGymContext";
import type { RecoveryPrescription, RecoveryScheduleKind } from "@/types/recovery";

type DraftSlot = {
  tempId: string;
  movementId?: string;
  movementName?: string;
  routineId?: string;
  routineName?: string;
  isPerSide?: boolean;
  prescription: RecoveryPrescription;
  notes: string;
};

type DraftDay = {
  dayIndex: number;
  slots: DraftSlot[];
};

let tempIdCounter = 0;
const tempId = () => `tmp-${Date.now()}-${tempIdCounter++}`;

export default function NewSchedulePage() {
  const router = useRouter();
  const create = useCreateRecoverySchedule();
  const activeMembership = useActiveMembership();
  const { data: ctx } = useGymContext();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<RecoveryScheduleKind>("day_keyed");
  const [rotationDays, setRotationDays] = useState(3);
  const [weeklyTarget, setWeeklyTarget] = useState(2);
  const [scope, setScope] = useState<"personal" | "gym">("personal");
  const [activeDay, setActiveDay] = useState(1);

  const isCoachOrAdmin = !!ctx?.memberships.some(
    (m) => m.isActive && (m.isAdmin || m.isCoach)
  );

  const initDays = (count: number): DraftDay[] =>
    Array.from({ length: count }, (_, i) => ({ dayIndex: i + 1, slots: [] }));
  const [days, setDays] = useState<DraftDay[]>(initDays(3));
  const [freqSlots, setFreqSlots] = useState<DraftSlot[]>([]);

  // Adjust day count when rotation changes.
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

    const slots = kind === "day_keyed"
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
      const result = await create.mutateAsync({
        name: name.trim(),
        kind,
        rotationDays: kind === "day_keyed" ? rotationDays : undefined,
        weeklyTarget: kind === "frequency_keyed" ? weeklyTarget : undefined,
        description: description || undefined,
        communityId:
          scope === "gym" && activeMembership ? activeMembership.communityId : null,
        slots,
      });
      toast.success("Schedule created");
      router.push(`/recovery/schedules/${result.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const currentSlots = kind === "day_keyed"
    ? days.find((d) => d.dayIndex === activeDay)?.slots ?? []
    : freqSlots;

  const updateSlots = (next: DraftSlot[]) => {
    if (kind === "day_keyed") {
      setDays((prev) =>
        prev.map((d) => (d.dayIndex === activeDay ? { ...d, slots: next } : d))
      );
    } else {
      setFreqSlots(next);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">New schedule</h1>

      <Card>
        <CardContent className="py-3 space-y-3">
          <div>
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hip mobility — 3 day rotation" />
          </div>
          <div>
            <Label className="text-xs">Description (optional)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
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
          {kind === "day_keyed" ? (
            <div>
              <Label className="text-xs">Rotation days</Label>
              <Input
                type="number"
                min={1}
                max={14}
                value={rotationDays}
                onChange={(e) => updateRotationDays(Math.max(1, Math.min(14, Number(e.target.value) || 1)))}
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
                onChange={(e) => setWeeklyTarget(Math.max(1, Math.min(7, Number(e.target.value) || 1)))}
              />
            </div>
          )}
          {isCoachOrAdmin && activeMembership && (
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

      <SlotList slots={currentSlots} onChange={updateSlots} />

      <Button onClick={submit} disabled={create.isPending}>
        {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Save schedule
      </Button>
    </div>
  );
}

function SlotList({
  slots,
  onChange,
}: {
  slots: DraftSlot[];
  onChange: (next: DraftSlot[]) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const { data: movements } = useRecoveryMovements();
  const { data: routines } = useRecoveryRoutines();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const m = (movements ?? []).filter(
      (m) => m.isValidated && m.canonicalName.toLowerCase().includes(q)
    );
    const r = (routines ?? []).filter((r) => r.name.toLowerCase().includes(q));
    return { movements: m, routines: r };
  }, [movements, routines, search]);

  const addMovement = (id: string, name: string, isPerSide: boolean, defaultRx: RecoveryPrescription) => {
    onChange([
      ...slots,
      {
        tempId: tempId(),
        movementId: id,
        movementName: name,
        isPerSide,
        prescription: { ...defaultRx },
        notes: "",
      },
    ]);
    setShowPicker(false);
    setSearch("");
  };

  const addRoutine = (id: string, name: string) => {
    onChange([
      ...slots,
      {
        tempId: tempId(),
        routineId: id,
        routineName: name,
        prescription: {},
        notes: "",
      },
    ]);
    setShowPicker(false);
    setSearch("");
  };

  const updateSlot = (tempIdVal: string, patch: Partial<DraftSlot>) => {
    onChange(slots.map((s) => (s.tempId === tempIdVal ? { ...s, ...patch } : s)));
  };

  const removeSlot = (tempIdVal: string) =>
    onChange(slots.filter((s) => s.tempId !== tempIdVal));

  const move = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= slots.length) return;
    const next = [...slots];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {slots.map((s, idx) => (
        <Card key={s.tempId}>
          <CardContent className="py-3 space-y-2">
            <div className="flex items-start gap-2">
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => move(idx, -1)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  onClick={() => move(idx, 1)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {s.movementName ?? s.routineName}
                </p>
                {s.routineId && (
                  <Badge variant="secondary" className="text-[9px] mt-0.5">
                    Routine
                  </Badge>
                )}
              </div>
              <button
                onClick={() => removeSlot(s.tempId)}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            {s.movementId && (
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-[10px]">Sets</Label>
                  <Input
                    type="number"
                    value={s.prescription.sets ?? ""}
                    onChange={(e) =>
                      updateSlot(s.tempId, {
                        prescription: {
                          ...s.prescription,
                          sets: e.target.value ? Number(e.target.value) : undefined,
                        },
                      })
                    }
                  />
                </div>
                <div>
                  <Label className="text-[10px]">Reps</Label>
                  <Input
                    type="number"
                    value={s.prescription.reps ?? ""}
                    onChange={(e) =>
                      updateSlot(s.tempId, {
                        prescription: {
                          ...s.prescription,
                          reps: e.target.value ? Number(e.target.value) : undefined,
                          durationSeconds: undefined,
                        },
                      })
                    }
                  />
                </div>
                <div>
                  <Label className="text-[10px]">Hold (s)</Label>
                  <Input
                    type="number"
                    value={s.prescription.durationSeconds ?? ""}
                    onChange={(e) =>
                      updateSlot(s.tempId, {
                        prescription: {
                          ...s.prescription,
                          durationSeconds: e.target.value ? Number(e.target.value) : undefined,
                          reps: undefined,
                        },
                      })
                    }
                  />
                </div>
              </div>
            )}
            <Input
              placeholder="Notes…"
              value={s.notes}
              onChange={(e) => updateSlot(s.tempId, { notes: e.target.value })}
            />
          </CardContent>
        </Card>
      ))}

      {!showPicker ? (
        <Button onClick={() => setShowPicker(true)} variant="outline" size="sm">
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add movement
        </Button>
      ) : (
        <Card>
          <CardContent className="py-3 space-y-2">
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search movements & routines"
            />
            <div className="max-h-72 overflow-y-auto space-y-1">
              {filtered.routines.length > 0 && (
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mt-2">
                  Routines
                </p>
              )}
              {filtered.routines.map((r) => (
                <button
                  key={r.id}
                  onClick={() => addRoutine(r.id, r.name)}
                  className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted/40"
                >
                  {r.name}{" "}
                  <span className="text-[10px] text-muted-foreground">
                    ({r.movements?.length ?? 0} mov.)
                  </span>
                </button>
              ))}
              {filtered.movements.length > 0 && (
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mt-2">
                  Movements
                </p>
              )}
              {filtered.movements.map((m) => (
                <button
                  key={m.id}
                  onClick={() => addMovement(m.id, m.canonicalName, m.isPerSide, m.defaultPrescription)}
                  className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted/40"
                >
                  {m.canonicalName}
                </button>
              ))}
              {filtered.movements.length === 0 && filtered.routines.length === 0 && (
                <p className="text-xs text-muted-foreground py-2 text-center">
                  No matches
                </p>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowPicker(false)}>
              Cancel
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
