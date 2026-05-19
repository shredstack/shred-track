"use client";

// Coach/admin classes view (spec §2.2). Calendar-grid replacement: a
// simple week list of instances + per-instance actions (cancel, mark
// attendance). Schedule + slot management lives at /gym/classes/schedules.

import Link from "next/link";
import { useMemo, useState } from "react";
import { useGymContext } from "@/hooks/useGymContext";
import { useGymClasses, type ClassInstanceListItem } from "@/hooks/useClasses";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarDays, Settings } from "lucide-react";
import { GymToolHeader } from "@/components/gym/gym-tool-header";

interface CoachOption {
  id: string;
  name: string;
}

function useGymCoaches(communityId: string | null) {
  return useQuery<{ coaches: CoachOption[] }>({
    queryKey: ["gym", communityId, "coaches"],
    enabled: !!communityId,
    queryFn: async () => {
      const res = await fetch(`/api/gym/${communityId}/coaches`);
      if (!res.ok) throw new Error("Failed to load coaches");
      return res.json();
    },
  });
}

function weekBounds(offsetWeeks: number): { fromIso: string; toIso: string } {
  const now = new Date();
  const day = (now.getUTCDay() + 6) % 7;
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

export default function GymClassesAdminPage() {
  const { data: ctx } = useGymContext();
  const [weekOffset, setWeekOffset] = useState(0);
  const { fromIso, toIso } = useMemo(() => weekBounds(weekOffset), [weekOffset]);
  const activeId = ctx?.activeCommunityId ?? null;
  const { data, isLoading } = useGymClasses(activeId, fromIso, toIso);

  if (!activeId) return <p className="text-sm">Pick a gym.</p>;

  return (
    <div className="space-y-4">
      <GymToolHeader
        icon={CalendarDays}
        label="Classes"
        description="Today's roster, attendance, and per-class actions"
      />
      <div className="flex items-center justify-end">
        <Link href="/gym/classes/schedules">
          <Button size="sm" variant="outline">
            <Settings className="mr-1 size-4" />
            Schedules
          </Button>
        </Link>
      </div>
      <div className="flex items-center justify-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setWeekOffset((w) => w - 1)}
        >
          ←
        </Button>
        <span className="text-xs text-muted-foreground">
          {fromIso} → {toIso}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setWeekOffset((w) => w + 1)}
        >
          →
        </Button>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data?.instances.length ? (
        <p className="text-sm text-muted-foreground">
          No class instances this week. Create a schedule to start.
        </p>
      ) : (
        <AdminClassList
          instances={data.instances}
          communityId={activeId}
          fromIso={fromIso}
          toIso={toIso}
        />
      )}
    </div>
  );
}

function AdminClassList({
  instances,
  communityId,
  fromIso,
  toIso,
}: {
  instances: ClassInstanceListItem[];
  communityId: string;
  fromIso: string;
  toIso: string;
}) {
  const { data: coachData } = useGymCoaches(communityId);
  const coaches = coachData?.coaches ?? [];
  return (
    <>
      {instances.map((inst) => (
        <AdminClassRow
          key={inst.id}
          instance={inst}
          coaches={coaches}
          communityId={communityId}
          fromIso={fromIso}
          toIso={toIso}
        />
      ))}
    </>
  );
}

function AdminClassRow({
  instance,
  coaches,
  communityId,
  fromIso,
  toIso,
}: {
  instance: ClassInstanceListItem;
  coaches: CoachOption[];
  communityId: string;
  fromIso: string;
  toIso: string;
}) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({
      queryKey: ["gym", communityId, "classes", fromIso, toIso],
    });
  const cancel = useMutation({
    mutationFn: async () => {
      await fetch(`/api/classes/${instance.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
    },
    onSuccess: invalidate,
  });
  const setCoach = useMutation({
    mutationFn: async (coachId: string | null) => {
      const res = await fetch(`/api/classes/${instance.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "edit-coach", coachId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to set coach");
      }
    },
    onSuccess: invalidate,
  });
  const time = new Date(instance.startAt).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <Card>
      <CardContent className="space-y-2 py-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium truncate">{instance.name}</p>
              {instance.status === "cancelled" && (
                <Badge variant="destructive">Cancelled</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {time} · {instance.registeredCount}/{instance.capacity}
            </p>
          </div>
          <Link href={`/gym/classes/${instance.id}`}>
            <Button size="sm" variant="outline">
              Roster
            </Button>
          </Link>
          {instance.status !== "cancelled" && (
            <Button
              size="sm"
              variant="ghost"
              disabled={cancel.isPending}
              onClick={() => {
                if (confirm("Cancel this class?")) cancel.mutate();
              }}
            >
              Cancel
            </Button>
          )}
        </div>
        {instance.status !== "cancelled" && instance.kind === "class" ? (
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Coach
            </span>
            <Select
              value={instance.coachId ?? "none"}
              onValueChange={(v) => setCoach.mutate(v === "none" ? null : v)}
              disabled={setCoach.isPending}
            >
              <SelectTrigger className="h-7 w-[200px] text-xs">
                <SelectValue placeholder="No coach" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No coach</SelectItem>
                {coaches.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
