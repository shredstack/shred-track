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
  isActive: boolean;
  // null = every day; otherwise array of 0..6 (0=Sun).
  activeDaysOfWeek: number[] | null;
  // "Every N days" recurrence — when set, supersedes activeDaysOfWeek.
  intervalDays: number | null;
  intervalStartsOn: string | null;
  daySlots: DraftSlot[][]; // index = dayIndex - 1
  freqSlots: DraftSlot[];
}

function todayDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const DAY_OF_WEEK_LABELS: Array<{ value: number; short: string }> = [
  { value: 0, short: "Sun" },
  { value: 1, short: "Mon" },
  { value: 2, short: "Tue" },
  { value: 3, short: "Wed" },
  { value: 4, short: "Thu" },
  { value: 5, short: "Fri" },
  { value: 6, short: "Sat" },
];

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
  // Interval-mode schedules always collapse to a single rotation day — the
  // recurrence comes from intervalDays, not the day rotation.
  const isInitialInterval = !!(initial?.intervalDays && initial.intervalStartsOn);
  const [rotationDays, setRotationDays] = useState(
    isInitialInterval ? 1 : initial?.rotationDays ?? 3
  );
  const [weeklyTarget, setWeeklyTarget] = useState(initial?.weeklyTarget ?? 2);
  const [scope, setScope] = useState<"personal" | "gym">(
    initial?.communityId ? "gym" : "personal"
  );
  const [activeDay, setActiveDay] = useState(1);
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  // "every" = no day-of-week restriction (stored as null); "specific" lets
  // the user pick days; "interval" = every N days from a start date. Tracked
  // separately so toggling between modes doesn't lose state.
  const initialDowMode: "every" | "specific" | "interval" =
    initial?.intervalDays && initial.intervalStartsOn
      ? "interval"
      : initial?.activeDaysOfWeek && initial.activeDaysOfWeek.length > 0
        ? "specific"
        : "every";
  const [dowMode, setDowMode] = useState<"every" | "specific" | "interval">(initialDowMode);
  const [selectedDays, setSelectedDays] = useState<number[]>(
    initial?.activeDaysOfWeek ?? []
  );
  const [intervalDays, setIntervalDays] = useState<number>(
    initial?.intervalDays ?? 3
  );
  const [intervalStartsOn, setIntervalStartsOn] = useState<string>(
    initial?.intervalStartsOn ?? todayDateString()
  );

  const toggleDay = (d: number) => {
    setSelectedDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)
    );
  };

  const initDays = (count: number, prefill?: DraftSlot[][]): DraftDay[] =>
    Array.from({ length: count }, (_, i) => ({
      dayIndex: i + 1,
      slots: prefill?.[i] ?? [],
    }));

  const [days, setDays] = useState<DraftDay[]>(
    initDays(
      isInitialInterval ? 1 : initial?.rotationDays ?? 3,
      initial?.daySlots
    )
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

    // Resolve recurrence: "every" → both null; "specific" → activeDaysOfWeek
    // array (empty coerces to null = every day); "interval" → intervalDays +
    // intervalStartsOn (activeDaysOfWeek cleared). Interval is day_keyed-only.
    const effectiveDowMode = kind === "day_keyed" ? dowMode : (dowMode === "interval" ? "every" : dowMode);
    const activeDaysOfWeek =
      effectiveDowMode === "specific" && selectedDays.length > 0
        ? selectedDays
        : null;
    const effectiveIntervalDays =
      effectiveDowMode === "interval" ? intervalDays : null;
    const effectiveIntervalStartsOn =
      effectiveDowMode === "interval" ? intervalStartsOn : null;

    if (effectiveDowMode === "interval") {
      if (!Number.isInteger(intervalDays) || intervalDays < 1) {
        toast.error("Interval must be 1 or more days");
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(intervalStartsOn)) {
        toast.error("Pick a valid start date");
        return;
      }
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
            isActive,
            activeDaysOfWeek,
            intervalDays: effectiveIntervalDays,
            intervalStartsOn: effectiveIntervalStartsOn,
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
          isActive,
          activeDaysOfWeek,
          intervalDays: effectiveIntervalDays,
          intervalStartsOn: effectiveIntervalStartsOn,
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
                  onClick={() => {
                    setKind("frequency_keyed");
                    // Interval recurrence is day-rotation only; fall back to
                    // the every-day option when switching to frequency mode.
                    if (dowMode === "interval") setDowMode("every");
                  }}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm ${kind === "frequency_keyed" ? "border-primary bg-primary/10 text-primary" : "border-input"}`}
                >
                  X × per week
                </button>
              </div>
            </div>
          )}
          {kind === "day_keyed" ? (
            // In interval ("Every N days") mode the routine is a single
            // shared list, so the rotation-days input is hidden — N comes
            // from intervalDays instead.
            dowMode !== "interval" && (
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
            )
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
          <div>
            <Label className="text-xs">Show on calendar</Label>
            <div className="flex gap-2 mt-1">
              <button
                type="button"
                onClick={() => setIsActive(true)}
                className={`flex-1 rounded-md border px-3 py-2 text-sm ${isActive ? "border-primary bg-primary/10 text-primary" : "border-input"}`}
              >
                Active
              </button>
              <button
                type="button"
                onClick={() => setIsActive(false)}
                className={`flex-1 rounded-md border px-3 py-2 text-sm ${!isActive ? "border-primary bg-primary/10 text-primary" : "border-input"}`}
              >
                Inactive
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Inactive schedules are hidden from the recovery calendar but stay editable.
            </p>
          </div>
          {isActive && (
            <div>
              <Label className="text-xs">Recurrence</Label>
              <div className="flex gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => setDowMode("every")}
                  className={`flex-1 rounded-md border px-2 py-2 text-xs ${dowMode === "every" ? "border-primary bg-primary/10 text-primary" : "border-input"}`}
                >
                  Every day
                </button>
                <button
                  type="button"
                  onClick={() => setDowMode("specific")}
                  className={`flex-1 rounded-md border px-2 py-2 text-xs ${dowMode === "specific" ? "border-primary bg-primary/10 text-primary" : "border-input"}`}
                >
                  Specific days
                </button>
                {kind === "day_keyed" && (
                  <button
                    type="button"
                    onClick={() => {
                      setDowMode("interval");
                      // Interval mode = single shared list of movements that
                      // repeats every N days. Collapse the rotation to a
                      // single day so users don't have to re-add movements
                      // to Day 1 / Day 2 / Day 3.
                      if (rotationDays !== 1) updateRotationDays(1);
                    }}
                    className={`flex-1 rounded-md border px-2 py-2 text-xs ${dowMode === "interval" ? "border-primary bg-primary/10 text-primary" : "border-input"}`}
                  >
                    Every N days
                  </button>
                )}
              </div>
              {dowMode === "specific" && (
                <div className="flex gap-1 mt-2">
                  {DAY_OF_WEEK_LABELS.map((d) => {
                    const on = selectedDays.includes(d.value);
                    return (
                      <button
                        type="button"
                        key={d.value}
                        onClick={() => toggleDay(d.value)}
                        className={`flex-1 rounded-md border px-2 py-1.5 text-[11px] ${on ? "border-primary bg-primary/10 text-primary" : "border-input text-muted-foreground"}`}
                      >
                        {d.short}
                      </button>
                    );
                  })}
                </div>
              )}
              {dowMode === "specific" && selectedDays.length === 0 && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  No days selected — schedule will show every day.
                </p>
              )}
              {dowMode === "interval" && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div>
                    <Label className="text-[11px] text-muted-foreground">
                      Every
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={1}
                        max={365}
                        value={intervalDays}
                        onChange={(e) =>
                          setIntervalDays(
                            Math.max(
                              1,
                              Math.min(365, Number(e.target.value) || 1)
                            )
                          )
                        }
                      />
                      <span className="text-xs text-muted-foreground">
                        day{intervalDays === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground">
                      Starting
                    </Label>
                    <Input
                      type="date"
                      value={intervalStartsOn}
                      onChange={(e) => setIntervalStartsOn(e.target.value)}
                    />
                  </div>
                </div>
              )}
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

      {kind === "day_keyed" && dowMode !== "interval" && (
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
