"use client";

// Admin schedule editor (spec §2.2). Minimal form: name, default capacity,
// and one or more slots (days of week + start time + duration + active
// window). RRULE is composed from the day-of-week checkboxes.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useGymContext } from "@/hooks/useGymContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

interface ScheduleRow {
  id: string;
  name: string;
  description: string | null;
  defaultCapacity: number;
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
  const create = useMutation({
    mutationFn: async (payload: object) => {
      const res = await fetch(`/api/gym/${activeId}/classes/schedules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gym", activeId, "class-schedules"] });
    },
  });

  const [showForm, setShowForm] = useState(false);

  if (!activeId) return <p className="text-sm">Pick a gym.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Class schedules</h1>
        <Button size="sm" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancel" : "New schedule"}
        </Button>
      </div>
      {showForm && (
        <NewScheduleForm
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
          <Card key={s.id}>
            <CardContent className="space-y-2 py-3">
              <p className="text-sm font-medium">{s.name}</p>
              <p className="text-xs text-muted-foreground">
                Capacity {s.defaultCapacity} · {s.slots.length} slot
                {s.slots.length === 1 ? "" : "s"}
              </p>
              <div className="space-y-1">
                {s.slots.map((sl) => (
                  <p key={sl.id} className="text-xs">
                    {sl.rrule.replace(/^RRULE:/, "")} @ {sl.startTime} ·{" "}
                    {sl.durationMin}min · from {sl.activeFrom}
                  </p>
                ))}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

function NewScheduleForm({
  onSubmit,
  submitting,
}: {
  onSubmit: (payload: object) => void;
  submitting: boolean;
}) {
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState(20);
  const [days, setDays] = useState<Record<(typeof RRULE_DAYS)[number], boolean>>(
    () => ({ MO: true, TU: true, WE: true, TH: true, FR: true, SA: false, SU: false })
  );
  const [startTime, setStartTime] = useState("09:00");
  const [durationMin, setDurationMin] = useState(60);
  const [activeFrom, setActiveFrom] = useState(
    new Date().toISOString().slice(0, 10)
  );

  function submit() {
    const byday = RRULE_DAYS.filter((d) => days[d]).join(",");
    if (!byday) {
      alert("Pick at least one day");
      return;
    }
    if (!name.trim()) {
      alert("Schedule needs a name");
      return;
    }
    onSubmit({
      name,
      defaultCapacity: capacity,
      slots: [
        {
          rrule: `FREQ=WEEKLY;BYDAY=${byday}`,
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
        <div className="space-y-1">
          <Label>Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="9am CrossFit"
          />
        </div>
        <div className="space-y-1">
          <Label>Default capacity</Label>
          <Input
            type="number"
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value))}
          />
        </div>
        <div className="space-y-1">
          <Label>Days</Label>
          <div className="flex flex-wrap gap-2">
            {RRULE_DAYS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays((p) => ({ ...p, [d]: !p[d] }))}
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
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Duration (min)</Label>
            <Input
              type="number"
              value={durationMin}
              onChange={(e) => setDurationMin(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label>Active from</Label>
          <Input
            type="date"
            value={activeFrom}
            onChange={(e) => setActiveFrom(e.target.value)}
          />
        </div>
        <Button disabled={submitting} onClick={submit}>
          Save schedule
        </Button>
      </CardContent>
    </Card>
  );
}
