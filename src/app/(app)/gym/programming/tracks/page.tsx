"use client";

// Coach admin — list of programming tracks (spec §1.3).
//
// The "New track" sheet collects the minimum required fields (name, kind,
// dates) and then redirects to the detail page where the coach builds out
// the calendar via Smart Builder / CAP paste / progression generator.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { GymToolHeader } from "@/components/gym/gym-tool-header";
import { useGymContext } from "@/hooks/useGymContext";
import { useTracksList } from "@/hooks/useTracks";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export default function TracksAdminPage() {
  const { data: ctx } = useGymContext();
  const router = useRouter();
  const activeId = ctx?.activeCommunityId ?? null;
  const qc = useQueryClient();
  const { data, isLoading } = useTracksList(activeId);
  const [open, setOpen] = useState(false);

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
    onSuccess: (track) => {
      qc.invalidateQueries({ queryKey: ["gym", activeId, "tracks"] });
      setOpen(false);
      // Hop straight to the detail page so the coach can start authoring.
      router.push(`/gym/programming/tracks/${track.id}`);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed");
    },
  });

  if (!activeId) return <p className="text-sm">Pick a gym.</p>;

  return (
    <div className="space-y-4">
      <GymToolHeader
        icon={Sparkles}
        label="Programming tracks"
        description="Monthly challenges and event-prep arcs. Tap a track to author days via Smart Builder, CAP paste, or the progression generator."
      />
      <div className="flex items-center justify-end">
        <Button size="sm" onClick={() => setOpen(true)}>
          New track
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data?.tracks.length ? (
        <p className="text-sm text-muted-foreground">No tracks yet.</p>
      ) : (
        data.tracks.map((t) => (
          <Link key={t.id} href={`/gym/programming/tracks/${t.id}`}>
            <Card className="transition-colors hover:bg-muted/30">
              <CardContent className="space-y-1 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{t.name}</p>
                  <Badge variant="outline" className="text-[10px]">
                    {t.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t.kind} · {t.displayMode}
                  {t.inlinePosition ? ` (${t.inlinePosition})` : null} ·{" "}
                  {t.startsOn} → {t.endsOn}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full p-4 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>New programming track</SheetTitle>
            <SheetDescription>
              Pick a kind and date range. You&apos;ll author the days on the
              next screen.
            </SheetDescription>
          </SheetHeader>
          <NewTrackForm
            onSubmit={(p) => create.mutate(p)}
            submitting={create.isPending}
          />
        </SheetContent>
      </Sheet>
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
  const [kind, setKind] = useState("custom");
  const [displayMode, setDisplayMode] = useState("standalone");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");

  // Monthly challenges lock to inline + before_at_home (spec §2.1) since
  // no other configuration makes sense for them.
  const isMonthly = kind === "monthly_challenge";

  return (
    <div className="space-y-3 pt-4">
      <div className="space-y-1">
        <Label>Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="6 Week Murph Prep"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Kind</Label>
          <select
            value={kind}
            onChange={(e) => {
              const k = e.target.value;
              setKind(k);
              if (k === "monthly_challenge") setDisplayMode("inline");
            }}
            className="w-full rounded-md border border-white/10 bg-background px-2 py-1 text-sm"
          >
            <option value="custom">custom</option>
            <option value="monthly_challenge">monthly_challenge</option>
            <option value="event_prep">event_prep</option>
            <option value="cap">cap</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label>Display mode</Label>
          <select
            value={displayMode}
            onChange={(e) => setDisplayMode(e.target.value)}
            disabled={isMonthly}
            className="w-full rounded-md border border-white/10 bg-background px-2 py-1 text-sm disabled:opacity-50"
          >
            <option value="standalone">standalone (opt-in)</option>
            <option value="inline">inline (auto)</option>
            <option value="inline_and_standalone">
              inline + standalone
            </option>
          </select>
        </div>
      </div>
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
      <Button
        disabled={submitting || !name.trim() || !startsOn || !endsOn}
        onClick={() =>
          onSubmit({
            name,
            kind,
            displayMode,
            // Monthly challenges land between Stretching and At-Home; other
            // kinds default to end_of_day. Coaches can override on the
            // detail page.
            inlinePosition: isMonthly ? "before_at_home" : "end_of_day",
            startsOn,
            endsOn,
            status: "draft",
          })
        }
      >
        {submitting ? "Creating…" : "Create and open"}
      </Button>
    </div>
  );
}
