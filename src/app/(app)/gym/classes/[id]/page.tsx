"use client";

// Coach attendance UI for a single class instance. Pulls the roster and
// lets the coach toggle each registered member to attended/no_show. The
// server emits committed_club_progress/earned notifications on the first
// 'attended' status change per user per class.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
/* eslint-disable @next/next/no-img-element */
import { Badge } from "@/components/ui/badge";
import { useParams } from "next/navigation";
import { GymToolHeader } from "@/components/gym/gym-tool-header";
import { Users } from "lucide-react";

interface InstanceDetail {
  instance: {
    id: string;
    communityId: string;
    startAt: string;
    endAt: string;
    status: string;
    capacity: number;
  };
  isManager: boolean;
  roster: Array<{
    registrationId: string;
    userId: string;
    userName: string;
    userImage: string | null;
    status: "registered" | "cancelled" | "no_show" | "attended";
  }>;
}

export default function ClassInstancePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<InstanceDetail>({
    queryKey: ["class-instance", id],
    queryFn: async () => {
      const res = await fetch(`/api/classes/${id}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });
  const mark = useMutation({
    mutationFn: async (entries: Array<{ userId: string; status: string }>) => {
      const res = await fetch(`/api/classes/${id}/attendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["class-instance", id] });
    },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Not found.</p>;
  if (!data.isManager) {
    return (
      <p className="text-sm text-muted-foreground">
        Coach-only page. You aren&apos;t a manager of this gym.
      </p>
    );
  }

  const time = new Date(data.instance.startAt).toLocaleString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="space-y-4">
      <GymToolHeader
        icon={Users}
        label="Class roster"
        description={time}
        backHref="/gym/classes"
        backLabel="Classes"
      />

      <div className="flex justify-between">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const entries = data.roster
              .filter((r) => r.status === "registered")
              .map((r) => ({ userId: r.userId, status: "attended" }));
            if (entries.length) mark.mutate(entries);
          }}
        >
          Mark all attended
        </Button>
        <p className="text-xs text-muted-foreground">
          {data.roster.filter((r) => r.status !== "cancelled").length} on list
        </p>
      </div>
      <div className="space-y-2">
        {data.roster.map((r) => (
          <Card key={r.registrationId}>
            <CardContent className="flex items-center gap-3 py-3">
              {r.userImage ? (
                <img
                  src={r.userImage}
                  alt={r.userName}
                  className="size-8 rounded-full object-cover"
                />
              ) : (
                <div className="flex size-8 items-center justify-center rounded-full bg-muted text-xs">
                  {r.userName.slice(0, 1)}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{r.userName}</p>
                <Badge
                  variant={
                    r.status === "attended"
                      ? "default"
                      : r.status === "cancelled"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {r.status}
                </Badge>
              </div>
              <Button
                size="sm"
                variant={r.status === "attended" ? "default" : "outline"}
                onClick={() =>
                  mark.mutate([{ userId: r.userId, status: "attended" }])
                }
              >
                Attended
              </Button>
              <Button
                size="sm"
                variant={r.status === "no_show" ? "default" : "outline"}
                onClick={() =>
                  mark.mutate([{ userId: r.userId, status: "no_show" }])
                }
              >
                No-show
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
