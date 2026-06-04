"use client";

// Member-facing standalone track view (spec §2.4). Shows the track meta,
// today's prescription, and a join button for opt-in tracks like Murph
// Prep. After joining, "Log today" is enabled (deferred — score-logging
// against track days routes through the existing CrossFit flow once
// programming_track_days.workout_id is wired).

import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/shared/back-button";

interface TrackData {
  track: {
    id: string;
    name: string;
    description: string | null;
    kind: string;
    startsOn: string;
    endsOn: string;
    displayMode: string;
  };
  days: Array<{
    id: string;
    date: string;
    body: string | null;
    isScored: boolean;
  }>;
  today: string;
  todaysDay: { body: string | null; date: string } | null;
  joined: boolean;
}

export default function TrackPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<TrackData>({
    queryKey: ["track", id],
    queryFn: async () => {
      const res = await fetch(`/api/tracks/${id}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });
  const join = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/tracks/${id}/join`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["track", id] }),
  });
  const leave = useMutation({
    mutationFn: async () => {
      await fetch(`/api/tracks/${id}/join`, { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["track", id] }),
  });

  if (isLoading)
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data)
    return <p className="text-sm text-muted-foreground">Not found.</p>;

  return (
    <div className="space-y-4">
      <BackButton fallbackHref="/home" />
      <div>
        <h1 className="text-2xl font-bold">{data.track.name}</h1>
        <p className="text-sm text-muted-foreground">
          {data.track.startsOn} → {data.track.endsOn} · {data.track.kind}
        </p>
      </div>
      {data.track.description && (
        <p className="text-sm">{data.track.description}</p>
      )}
      {!data.joined ? (
        <Button onClick={() => join.mutate()} disabled={join.isPending}>
          Join {data.track.name}
        </Button>
      ) : (
        <Button
          variant="outline"
          onClick={() => leave.mutate()}
          disabled={leave.isPending}
        >
          Leave track
        </Button>
      )}
      {data.todaysDay && (
        <Card>
          <CardContent className="space-y-1 py-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Today · {data.today}
            </p>
            <p className="whitespace-pre-wrap text-sm">
              {data.todaysDay.body}
            </p>
          </CardContent>
        </Card>
      )}
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          All days
        </p>
        {data.days.map((d) => (
          <Card key={d.id}>
            <CardContent className="py-2">
              <p className="text-xs text-muted-foreground">{d.date}</p>
              <p className="whitespace-pre-wrap text-sm">{d.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
