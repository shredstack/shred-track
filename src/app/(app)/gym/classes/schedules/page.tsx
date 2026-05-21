"use client";

// Admin schedule editor (spec §2.2). Create, edit, and delete weekly
// recurring class schedules. A schedule has a name, description, default
// capacity, default coach, and one or more slots (days of week + start
// time + duration + active window). RRULE is composed from the
// day-of-week checkboxes.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useGymContext } from "@/hooks/useGymContext";
import { useGymCoaches, type CoachOption } from "@/hooks/useClasses";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { GymToolHeader } from "@/components/gym/gym-tool-header";
import { CoachPicker } from "@/components/gym/coach-picker";
import { CalendarRange } from "lucide-react";
import { toast } from "sonner";

const RRULE_DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
const DAY_LABELS: Record<(typeof RRULE_DAYS)[number], string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};

type RruleDay = (typeof RRULE_DAYS)[number];
type DayMap = Record<RruleDay, boolean>;

/** Compose a weekly RRULE from the day-of-week checkboxes. */
function buildRrule(days: DayMap): string {
  return `FREQ=WEEKLY;BYDAY=${RRULE_DAYS.filter((d) => days[d]).join(",")}`;
}

/** Parse an RRULE's BYDAY back into day-of-week checkbox state. */
function parseRruleDays(rrule: string): DayMap {
  const match = /BYDAY=([A-Z,]+)/.exec(rrule);
  const set = new Set((match?.[1] ?? "").split(","));
  return RRULE_DAYS.reduce((acc, d) => {
    acc[d] = set.has(d);
    return acc;
  }, {} as DayMap);
}

interface ScheduleRow {
  id: string;
  name: string;
  description: string | null;
  defaultCapacity: number;
  defaultCoachId: string | null;
  isActive: boolean;
  slots: Array<{
    id: string;
    rrule: string;
    startTime: string;
    durationMin: number;
    activeFrom: string;
    activeTo: string | null;
  }>;
}

export default function SchedulesPage() {
  const { data: ctx } = useGymContext();
  const activeId = ctx?.activeCommunityId ?? null;
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ schedules: ScheduleRow[] }>({
    queryKey: ["gym", activeId, "class-schedules"],
    enabled: !!activeId,
    queryFn: async () => {
      const res = await fetch(`/api/gym/${activeId}/classes/schedules`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });
  const { data: coachData } = useGymCoaches(activeId);
  const coaches = useMemo(() => coachData?.coaches ?? [], [coachData]);
  const coachName = useMemo(() => {
    const map = new Map(coaches.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? map.get(id) ?? "Unknown coach" : null);
  }, [coaches]);
  const create = useMutation({
    mutationFn: async (payload: object) => {
      const res = await fetch(`/api/gym/${activeId}/classes/schedules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok && res.status !== 207) {
        throw new Error(body?.error ?? "Failed to save schedule");
      }
      // 207: schedule saved but instance materialization failed. Surface the
      // warning so the coach knows to retry rather than thinking it worked.
      if (res.status === 207 && body?.warning) {
        toast.warning(body.warning);
      } else {
        toast.success("Schedule saved");
      }
      return body;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gym", activeId, "class-schedules"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const [showForm, setShowForm] = useState(false);

  if (!activeId) return <p className="text-sm">Pick a gym.</p>;

  return (
    <div className="space-y-4">
      <GymToolHeader
        icon={CalendarRange}
        label="Class schedules"
        description="Weekly recurring slots. Classes appear on the schedule immediately after saving."
        backHref="/gym/classes"
        backLabel="Classes"
      />
      <div className="flex items-center justify-end">
        <Button size="sm" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancel" : "New schedule"}
        </Button>
      </div>
      {showForm && (
        <NewScheduleForm
          coaches={coaches}
          onSubmit={(payload) => {
            create.mutate(payload, {
              onSuccess: () => setShowForm(false),
            });
          }}
          submitting={create.isPending}
        />
      )}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data?.schedules.length ? (
        <p className="text-sm text-muted-foreground">
          No schedules yet. Create one to start materializing class instances.
        </p>
      ) : (
        data.schedules.map((s) => (
          <ScheduleCard
            key={s.id}
            schedule={s}
            coaches={coaches}
            communityId={activeId}
            coachName={coachName}
          />
        ))
      )}
    </div>
  );
}

/**
 * Read-only schedule card with Edit / Delete actions. Editing swaps the
 * card for an inline form; deleting confirms then archives the schedule.
 */
function ScheduleCard({
  schedule,
  coaches,
  communityId,
  coachName,
}: {
  schedule: ScheduleRow;
  coaches: CoachOption[];
  communityId: string;
  coachName: (id: string | null) => string | null;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["gym", communityId, "class-schedules"] });
    // Coach/capacity edits and deletes also touch materialized instances.
    qc.invalidateQueries({ queryKey: ["gym", communityId, "classes"] });
  };

  const update = useMutation({
    mutationFn: async (payload: object) => {
      const res = await fetch(
        `/api/gym/${communityId}/classes/schedules/${schedule.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to update schedule");
      return body;
    },
    onSuccess: (body) => {
      // 200 + `warning` means the schedule saved but re-materialization
      // failed — surface it so the coach knows to retry rather than assuming
      // the new times took effect.
      if (body?.warning) toast.warning(body.warning);
      else toast.success("Schedule updated");
      invalidate();
      setEditing(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/gym/${communityId}/classes/schedules/${schedule.id}`,
        { method: "DELETE" }
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to delete schedule");
      return body as { cancelled: number; deleted: number };
    },
    onSuccess: (body) => {
      const parts: string[] = [];
      if (body.deleted) parts.push(`${body.deleted} removed`);
      if (body.cancelled) parts.push(`${body.cancelled} cancelled`);
      toast.success(
        parts.length
          ? `Schedule deleted — ${parts.join(", ")}`
          : "Schedule deleted"
      );
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (editing) {
    return (
      <EditScheduleForm
        schedule={schedule}
        coaches={coaches}
        submitting={update.isPending}
        onCancel={() => setEditing(false)}
        onSubmit={(payload) => update.mutate(payload)}
      />
    );
  }

  return (
    <Card>
      <CardContent className="space-y-2 py-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium">{schedule.name}</p>
          <div className="flex shrink-0 gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={remove.isPending}
              onClick={() => {
                if (
                  confirm(
                    "Delete this schedule? Upcoming classes with no sign-ups are removed; ones with sign-ups are cancelled and members are notified. Past classes are kept."
                  )
                ) {
                  remove.mutate();
                }
              }}
            >
              Delete
            </Button>
          </div>
        </div>
        {schedule.description && (
          <p className="text-xs text-muted-foreground whitespace-pre-line">
            {schedule.description}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Capacity {schedule.defaultCapacity} · {schedule.slots.length} slot
          {schedule.slots.length === 1 ? "" : "s"} · Coach:{" "}
          {coachName(schedule.defaultCoachId) ?? "Unassigned"}
        </p>
        <div className="space-y-1">
          {schedule.slots.map((sl) => (
            <p key={sl.id} className="text-xs">
              {sl.rrule.replace(/^RRULE:/, "")} @ {sl.startTime} ·{" "}
              {sl.durationMin}min · from {sl.activeFrom}
            </p>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Shared name / description / capacity / coach fields. Used by both the
 * create and edit forms so the two experiences stay identical.
 */
function ScheduleBasicsFields({
  coaches,
  name,
  onName,
  description,
  onDescription,
  capacity,
  onCapacity,
  defaultCoachId,
  onDefaultCoachId,
}: {
  coaches: CoachOption[];
  name: string;
  onName: (v: string) => void;
  description: string;
  onDescription: (v: string) => void;
  capacity: number;
  onCapacity: (v: number) => void;
  defaultCoachId: string | null;
  onDefaultCoachId: (v: string | null) => void;
}) {
  return (
    <>
      <div className="space-y-1">
        <Label>Name</Label>
        <Input
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder="9am CrossFit"
        />
      </div>
      <div className="space-y-1">
        <Label>Description</Label>
        <Textarea
          value={description}
          onChange={(e) => onDescription(e.target.value)}
          placeholder="What members should know about this class"
          rows={2}
        />
        <p className="text-xs text-muted-foreground">
          Shown to members on every class this schedule populates.
        </p>
      </div>
      <div className="space-y-1">
        <Label>Default capacity</Label>
        <Input
          type="number"
          value={capacity}
          onChange={(e) => onCapacity(Number(e.target.value))}
        />
      </div>
      <div className="space-y-1">
        <Label>Default coach</Label>
        <CoachPicker
          coaches={coaches}
          value={defaultCoachId}
          onChange={onDefaultCoachId}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">
          Auto-assigned to every class in this schedule. You can override the
          coach on individual dates from the Classes screen.
        </p>
      </div>
    </>
  );
}

/**
 * Shared recurrence fields — days of week, start time, duration, and the
 * date the schedule starts producing classes. Used by both the create and
 * edit forms so the two experiences stay identical.
 */
function ScheduleSlotFields({
  days,
  onToggleDay,
  startTime,
  onStartTime,
  durationMin,
  onDurationMin,
  activeFrom,
  onActiveFrom,
}: {
  days: DayMap;
  onToggleDay: (d: RruleDay) => void;
  startTime: string;
  onStartTime: (v: string) => void;
  durationMin: number;
  onDurationMin: (v: number) => void;
  activeFrom: string;
  onActiveFrom: (v: string) => void;
}) {
  return (
    <>
      <div className="space-y-1">
        <Label>Days</Label>
        <div className="flex flex-wrap gap-2">
          {RRULE_DAYS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onToggleDay(d)}
              className={`rounded-md border px-2 py-1 text-xs ${
                days[d]
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-white/10 text-muted-foreground"
              }`}
            >
              {DAY_LABELS[d]}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Start time (gym-local)</Label>
          <Input
            type="time"
            value={startTime}
            onChange={(e) => onStartTime(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label>Duration (min)</Label>
          <Input
            type="number"
            value={durationMin}
            onChange={(e) => onDurationMin(Number(e.target.value))}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label>Active from</Label>
        <Input
          type="date"
          value={activeFrom}
          onChange={(e) => onActiveFrom(e.target.value)}
        />
      </div>
    </>
  );
}

function NewScheduleForm({
  coaches,
  onSubmit,
  submitting,
}: {
  coaches: CoachOption[];
  onSubmit: (payload: object) => void;
  submitting: boolean;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [capacity, setCapacity] = useState(20);
  const [defaultCoachId, setDefaultCoachId] = useState<string | null>(null);
  const [days, setDays] = useState<Record<(typeof RRULE_DAYS)[number], boolean>>(
    () => ({ MO: true, TU: true, WE: true, TH: true, FR: true, SA: false, SU: false })
  );
  const [startTime, setStartTime] = useState("09:00");
  const [durationMin, setDurationMin] = useState(60);
  const [activeFrom, setActiveFrom] = useState(
    new Date().toISOString().slice(0, 10)
  );

  function submit() {
    if (!RRULE_DAYS.some((d) => days[d])) {
      toast.error("Pick at least one day");
      return;
    }
    if (!name.trim()) {
      toast.error("Schedule needs a name");
      return;
    }
    onSubmit({
      name,
      description: description.trim() || null,
      defaultCapacity: capacity,
      defaultCoachId,
      slots: [
        {
          rrule: buildRrule(days),
          startTime: `${startTime}:00`,
          durationMin,
          activeFrom,
        },
      ],
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-3">
        <ScheduleBasicsFields
          coaches={coaches}
          name={name}
          onName={setName}
          description={description}
          onDescription={setDescription}
          capacity={capacity}
          onCapacity={setCapacity}
          defaultCoachId={defaultCoachId}
          onDefaultCoachId={setDefaultCoachId}
        />
        <ScheduleSlotFields
          days={days}
          onToggleDay={(d) => setDays((p) => ({ ...p, [d]: !p[d] }))}
          startTime={startTime}
          onStartTime={setStartTime}
          durationMin={durationMin}
          onDurationMin={setDurationMin}
          activeFrom={activeFrom}
          onActiveFrom={setActiveFrom}
        />
        <Button disabled={submitting} onClick={submit}>
          Save schedule
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * Inline editor for an existing schedule. Edits the schedule basics plus the
 * recurrence slot (days / start time / duration / "active from" date).
 * Changing the recurrence regenerates upcoming classes — see the PATCH route.
 */
function EditScheduleForm({
  schedule,
  coaches,
  submitting,
  onCancel,
  onSubmit,
}: {
  schedule: ScheduleRow;
  coaches: CoachOption[];
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (payload: object) => void;
}) {
  // The schedule UI manages a single recurrence slot per schedule.
  const slot = schedule.slots[0] ?? null;
  const [name, setName] = useState(schedule.name);
  const [description, setDescription] = useState(schedule.description ?? "");
  const [capacity, setCapacity] = useState(schedule.defaultCapacity);
  const [defaultCoachId, setDefaultCoachId] = useState<string | null>(
    schedule.defaultCoachId
  );
  const [days, setDays] = useState<DayMap>(() =>
    parseRruleDays(slot?.rrule ?? "")
  );
  const [startTime, setStartTime] = useState(
    slot ? slot.startTime.slice(0, 5) : "09:00"
  );
  const [durationMin, setDurationMin] = useState(slot?.durationMin ?? 60);
  const [activeFrom, setActiveFrom] = useState(
    slot?.activeFrom ?? new Date().toISOString().slice(0, 10)
  );

  function submit() {
    if (!name.trim()) {
      toast.error("Schedule needs a name");
      return;
    }
    const payload: Record<string, unknown> = {
      name,
      description: description.trim() || null,
      defaultCapacity: capacity,
      defaultCoachId,
    };

    if (slot) {
      if (!RRULE_DAYS.some((d) => days[d])) {
        toast.error("Pick at least one day");
        return;
      }
      const rrule = buildRrule(days);
      const startTimeFull = `${startTime}:00`;
      const recurrenceChanged =
        slot.rrule !== rrule ||
        slot.startTime !== startTimeFull ||
        slot.durationMin !== durationMin ||
        slot.activeFrom !== activeFrom;
      if (
        recurrenceChanged &&
        !confirm(
          "Changing the days, time, or start date regenerates upcoming classes. Members registered for an affected class are notified it was cancelled and will need to register again. Continue?"
        )
      ) {
        return;
      }
      payload.slot = {
        id: slot.id,
        rrule,
        startTime: startTimeFull,
        durationMin,
        activeFrom,
      };
    }

    onSubmit(payload);
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-3">
        <ScheduleBasicsFields
          coaches={coaches}
          name={name}
          onName={setName}
          description={description}
          onDescription={setDescription}
          capacity={capacity}
          onCapacity={setCapacity}
          defaultCoachId={defaultCoachId}
          onDefaultCoachId={setDefaultCoachId}
        />
        {slot ? (
          <ScheduleSlotFields
            days={days}
            onToggleDay={(d) => setDays((p) => ({ ...p, [d]: !p[d] }))}
            startTime={startTime}
            onStartTime={setStartTime}
            durationMin={durationMin}
            onDurationMin={setDurationMin}
            activeFrom={activeFrom}
            onActiveFrom={setActiveFrom}
          />
        ) : null}
        <p className="text-xs text-muted-foreground">
          Capacity and coach changes apply to upcoming classes that haven&apos;t
          been individually overridden on the Classes screen. Changing the days,
          time, or start date regenerates upcoming classes.
        </p>
        <div className="flex gap-2">
          <Button disabled={submitting} onClick={submit}>
            Save changes
          </Button>
          <Button variant="outline" disabled={submitting} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
