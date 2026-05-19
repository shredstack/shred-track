"use client";

// Gym events admin (PR 3 §3.3).
//
// Lists upcoming events (class_instances with kind='event') for the
// active gym and lets the admin create new ones. Members register
// through the same /classes flow as regular classes.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useGymContext } from "@/hooks/useGymContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { CalendarPlus, ChevronRight, Loader2, Sparkles } from "lucide-react";

interface InstanceRow {
  id: string;
  scheduleId: string | null;
  name: string;
  startAt: string;
  endAt: string;
  capacity: number;
  status: string;
  kind: string;
  eventTitle: string | null;
  eventImageUrl: string | null;
  eventDescription: string | null;
  registeredCount: number;
}

export default function GymEventsPage() {
  const { data: ctx } = useGymContext();
  const activeId = ctx?.activeCommunityId ?? null;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  // Window: today + 365 days. Events are rarer than classes so we just
  // grab the year ahead.
  const { from, to } = useMemo(() => {
    const now = new Date();
    const fromIso = now.toISOString().slice(0, 10);
    const toDate = new Date(now);
    toDate.setUTCDate(toDate.getUTCDate() + 365);
    return { from: fromIso, to: toDate.toISOString().slice(0, 10) };
  }, []);

  const { data, isLoading } = useQuery<{ instances: InstanceRow[] }>({
    queryKey: ["gym", activeId, "events", from, to],
    enabled: !!activeId,
    queryFn: async () => {
      const res = await fetch(
        `/api/gym/${activeId}/classes/instances?from=${from}&to=${to}`
      );
      if (!res.ok) throw new Error("Failed to load events");
      return res.json();
    },
  });

  const events = useMemo(
    () =>
      (data?.instances ?? []).filter(
        (r) => r.kind === "event" && r.status !== "cancelled"
      ),
    [data]
  );

  if (!activeId) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Pick a gym to manage events.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Events</h1>
        <Button size="sm" onClick={() => setOpen(true)}>
          <CalendarPlus className="mr-1 h-3.5 w-3.5" />
          New event
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Events are one-off class instances — Murph, partner WODs, fundraisers.
        Members register through the same flow as regular classes.
      </p>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : events.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No upcoming events. Create your first.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {events.map((e) => (
            <Link
              key={e.id}
              href={`/gym/classes/${e.id}`}
              className="block"
            >
              <Card className="hover:bg-muted/30 transition-colors">
                <CardContent className="flex items-center gap-3 py-3">
                  {e.eventImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={e.eventImageUrl}
                      alt={e.name}
                      className="h-12 w-12 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                      <Sparkles className="h-4 w-4 text-primary" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{e.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(e.startAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}{" "}
                      · {e.registeredCount}/{e.capacity} registered
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <NewEventDialog
        open={open}
        onClose={() => setOpen(false)}
        communityId={activeId}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ["gym", activeId, "events"] });
        }}
      />
    </div>
  );
}

function NewEventDialog({
  open,
  onClose,
  communityId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  communityId: string;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  // Empty string default avoids `new Date()` in render (lint rule).
  const [startAt, setStartAt] = useState("");
  const [duration, setDuration] = useState("90");
  const [capacity, setCapacity] = useState("40");

  const create = useMutation({
    mutationFn: async () => {
      if (!startAt) throw new Error("Pick a start date/time");
      const start = new Date(startAt);
      if (Number.isNaN(start.getTime())) throw new Error("Invalid start time");
      const durationMin = parseInt(duration, 10) || 90;
      const end = new Date(start.getTime() + durationMin * 60_000);
      const cap = parseInt(capacity, 10) || 40;
      const res = await fetch(
        `/api/gym/${communityId}/classes/instances`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startAt: start.toISOString(),
            endAt: end.toISOString(),
            capacity: cap,
            kind: "event",
            eventTitle: title.trim(),
            eventImageUrl: imageUrl.trim() || null,
            eventDescription: description.trim() || null,
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to create event");
      }
    },
    onSuccess: () => {
      onCreated();
      toast.success("Event created");
      setTitle("");
      setDescription("");
      setImageUrl("");
      setStartAt("");
      setDuration("90");
      setCapacity("40");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New event</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Murph 2026"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="What members should know — meet time, what to bring, format…"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Banner image URL</Label>
            <Input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://…"
            />
            <p className="text-[11px] text-muted-foreground">
              Paste a publicly accessible URL. (Storage upload helper is a
              follow-up.)
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 space-y-1.5">
              <Label>Start</Label>
              <Input
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Duration (min)</Label>
              <Input
                type="number"
                min={15}
                step={15}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Capacity</Label>
            <Input
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate()}
            disabled={!title.trim() || !startAt || create.isPending}
          >
            {create.isPending && (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            )}
            Create event
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
