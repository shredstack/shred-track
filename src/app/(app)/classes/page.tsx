"use client";

// Member-facing class schedule (spec §2.2). Week-ahead view of class
// instances for the active gym, with register/cancel actions. When the
// `classes` flag is off or the user has no active gym, the page is empty.

import { useMemo, useState } from "react";
import { useGymContext } from "@/hooks/useGymContext";
import { useIsFeatureOn } from "@/hooks/useFeatureFlag";
import {
  useGymClasses,
  useRegisterForClass,
  useUnregisterFromClass,
  type ClassInstanceListItem,
} from "@/hooks/useClasses";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

function weekBounds(offsetWeeks: number): { fromIso: string; toIso: string } {
  const now = new Date();
  const day = (now.getUTCDay() + 6) % 7; // monday=0
  const monday = new Date(now);
  monday.setUTCDate(monday.getUTCDate() - day + offsetWeeks * 7);
  monday.setUTCHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  return {
    fromIso: monday.toISOString().slice(0, 10),
    toIso: sunday.toISOString().slice(0, 10),
  };
}

export default function ClassesPage() {
  const { data: ctx } = useGymContext();
  const classesOn = useIsFeatureOn("classes");
  const [weekOffset, setWeekOffset] = useState(0);
  const { fromIso, toIso } = useMemo(() => weekBounds(weekOffset), [weekOffset]);
  const activeId = ctx?.activeCommunityId ?? null;
  const { data, isLoading } = useGymClasses(activeId, fromIso, toIso);

  if (!activeId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Classes</h1>
        <p className="text-sm text-muted-foreground">
          Join a gym to see its class schedule.
        </p>
      </div>
    );
  }
  if (!classesOn) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Classes</h1>
        <p className="text-sm text-muted-foreground">
          Class scheduling isn&apos;t turned on for this gym yet.
        </p>
      </div>
    );
  }

  const byDay = new Map<string, ClassInstanceListItem[]>();
  for (const c of data?.instances ?? []) {
    const day = c.startAt.slice(0, 10);
    const list = byDay.get(day) ?? [];
    list.push(c);
    byDay.set(day, list);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Classes</h1>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setWeekOffset((w) => w - 1)}
          >
            ←
          </Button>
          <span className="text-xs text-muted-foreground">
            {weekOffset === 0 ? "This week" : `Week ${weekOffset > 0 ? "+" : ""}${weekOffset}`}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setWeekOffset((w) => w + 1)}
          >
            →
          </Button>
        </div>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : byDay.size === 0 ? (
        <p className="text-sm text-muted-foreground">No classes this week.</p>
      ) : (
        [...byDay.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([day, list]) => (
            <DayBlock
              key={day}
              day={day}
              instances={list}
              communityId={activeId}
              fromIso={fromIso}
              toIso={toIso}
            />
          ))
      )}
    </div>
  );
}

function DayBlock({
  day,
  instances,
  communityId,
  fromIso,
  toIso,
}: {
  day: string;
  instances: ClassInstanceListItem[];
  communityId: string;
  fromIso: string;
  toIso: string;
}) {
  const label = new Date(`${day}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {instances.map((i) => (
        <ClassRow
          key={i.id}
          instance={i}
          communityId={communityId}
          fromIso={fromIso}
          toIso={toIso}
        />
      ))}
    </div>
  );
}

function ClassRow({
  instance,
  communityId,
  fromIso,
  toIso,
}: {
  instance: ClassInstanceListItem;
  communityId: string;
  fromIso: string;
  toIso: string;
}) {
  const register = useRegisterForClass(communityId, fromIso, toIso);
  const unregister = useUnregisterFromClass(communityId, fromIso, toIso);
  const time = new Date(instance.startAt).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const isCancelled = instance.status === "cancelled";
  const isRegistered =
    instance.myStatus === "registered" || instance.myStatus === "attended";

  return (
    <Card id={`class-${instance.id}`}>
      <CardContent className="flex items-center gap-3 py-3">
        <div className="w-16 shrink-0 text-sm font-medium">{time}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">{instance.name}</p>
            {isCancelled && <Badge variant="destructive">Cancelled</Badge>}
            {instance.kind === "event" && <Badge>Event</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            {instance.registeredCount}/{instance.capacity}
            {instance.coachName ? ` · ${instance.coachName}` : null}
          </p>
        </div>
        {isCancelled ? null : isRegistered ? (
          <Button
            size="sm"
            variant="outline"
            disabled={unregister.isPending}
            onClick={() => unregister.mutate(instance.id)}
          >
            Cancel
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={register.isPending}
            onClick={() => register.mutate(instance.id)}
          >
            Register
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
