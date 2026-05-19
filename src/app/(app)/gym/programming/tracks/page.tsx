"use client";

// Coach admin: list + create programming tracks (spec §2.4). Tracks
// shipped by the form are inserted with optional day prescriptions
// parsed from a textarea ("Day 1: ..." per line).

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useGymContext } from "@/hooks/useGymContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface TrackRow {
  id: string;
  name: string;
  kind: string;
  displayMode: string;
  inlinePosition: string | null;
  startsOn: string;
  endsOn: string;
  status: string;
}

export default function TracksAdminPage() {
  const { data: ctx } = useGymContext();
  const activeId = ctx?.activeCommunityId ?? null;
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ tracks: TrackRow[] }>({
    queryKey: ["gym", activeId, "tracks"],
    enabled: !!activeId,
    queryFn: async () => {
      const res = await fetch(`/api/gym/${activeId}/tracks`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });
  const create = useMutation({
    mutationFn: async (payload: object) => {
      const res = await fetch(`/api/gym/${activeId}/tracks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gym", activeId, "tracks"] });
    },
  });
  const [showForm, setShowForm] = useState(false);

  if (!activeId) return <p className="text-sm">Pick a gym.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Programming tracks</h1>
        <Button size="sm" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancel" : "New track"}
        </Button>
      </div>
      {showForm && (
        <NewTrackForm
          onSubmit={(p) =>
            create.mutate(p, { onSuccess: () => setShowForm(false) })
          }
          submitting={create.isPending}
        />
      )}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data?.tracks.length ? (
        <p className="text-sm text-muted-foreground">No tracks yet.</p>
      ) : (
        data.tracks.map((t) => (
          <Card key={t.id}>
            <CardContent className="space-y-1 py-3">
              <p className="text-sm font-medium">{t.name}</p>
              <p className="text-xs text-muted-foreground">
                {t.kind} · {t.displayMode}
                {t.inlinePosition ? ` (${t.inlinePosition})` : null} ·{" "}
                {t.startsOn} → {t.endsOn} · {t.status}
              </p>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

function NewTrackForm({
  onSubmit,
  submitting,
}: {
  onSubmit: (payload: object) => void;
  submitting: boolean;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("monthly_challenge");
  const [displayMode, setDisplayMode] = useState("inline");
  const [inlinePosition, setInlinePosition] = useState("end_of_day");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [daysText, setDaysText] = useState("");

  return (
    <Card>
      <CardContent className="space-y-3 py-3">
        <div className="space-y-1">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Kind</Label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-background px-2 py-1 text-sm"
            >
              <option value="monthly_challenge">monthly_challenge</option>
              <option value="event_prep">event_prep</option>
              <option value="cap">cap</option>
              <option value="custom">custom</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label>Display mode</Label>
            <select
              value={displayMode}
              onChange={(e) => setDisplayMode(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-background px-2 py-1 text-sm"
            >
              <option value="inline">inline</option>
              <option value="standalone">standalone</option>
              <option value="inline_and_standalone">
                inline_and_standalone
              </option>
            </select>
          </div>
        </div>
        {(displayMode === "inline" || displayMode === "inline_and_standalone") && (
          <div className="space-y-1">
            <Label>Inline position</Label>
            <select
              value={inlinePosition}
              onChange={(e) => setInlinePosition(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-background px-2 py-1 text-sm"
            >
              <option value="end_of_day">end_of_day</option>
              <option value="after_wod">after_wod</option>
              <option value="top">top</option>
            </select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Starts on</Label>
            <Input
              type="date"
              value={startsOn}
              onChange={(e) => setStartsOn(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Ends on</Label>
            <Input
              type="date"
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label>Day prescriptions</Label>
          <Textarea
            rows={6}
            value={daysText}
            onChange={(e) => setDaysText(e.target.value)}
            placeholder={"Day 1: 25 push-ups\nDay 2: 30 push-ups\n..."}
          />
          <p className="text-[10px] text-muted-foreground">
            Format: <code>Day 1: …</code> per line. Dates derived from
            &quot;Starts on&quot;.
          </p>
        </div>
        <Button
          disabled={submitting || !name.trim()}
          onClick={() =>
            onSubmit({
              name,
              kind,
              displayMode,
              inlinePosition:
                displayMode === "inline" || displayMode === "inline_and_standalone"
                  ? inlinePosition
                  : null,
              startsOn,
              endsOn,
              daysText: daysText.trim() || undefined,
              status: "active",
            })
          }
        >
          Create track
        </Button>
      </CardContent>
    </Card>
  );
}
