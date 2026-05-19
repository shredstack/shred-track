"use client";

// PR 3 §3.7 — minimal gym Hyrox programming card.
//
// Renders the week's gym-programmed Hyrox workouts above the existing
// personal-plan flow. Only mounts when (a) the user has an active gym,
// (b) the gym has the `hyrox_programming` feature flag on, and (c) the
// API returns at least one workout in the week window.
//
// Full gym Hyrox UI (per-station leaderboards, class schedule, etc.) is
// deferred — this just ensures CFD's Hyrox class members see the head
// coach's programming on the tab they expect.

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useGymContext } from "@/hooks/useGymContext";
import { useIsFeatureOn } from "@/hooks/useFeatureFlag";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

interface HyroxWorkoutRow {
  id: string;
  title: string | null;
  description: string | null;
  workoutDate: string;
  workoutType: string;
}

function weekWindow(): { from: string; to: string } {
  // Empty string defaults avoid `new Date()` in render. We use the UTC
  // calendar week here — that's "good enough" for surfacing this week's
  // gym workouts. The detail view (CrossFit-style) reads gym timezone.
  const now = new Date();
  const day = now.getUTCDay();
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - ((day + 6) % 7));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    from: monday.toISOString().slice(0, 10),
    to: sunday.toISOString().slice(0, 10),
  };
}

export function GymHyroxWeekCard() {
  const { data: ctx } = useGymContext();
  const activeId = ctx?.activeCommunityId ?? null;
  const flagOn = useIsFeatureOn("hyrox_programming");

  const { from, to } = useMemo(() => weekWindow(), []);

  const { data, isLoading } = useQuery<{ workouts: HyroxWorkoutRow[] }>({
    queryKey: ["gym", activeId, "hyrox-workouts", from, to],
    enabled: !!activeId && flagOn,
    queryFn: async () => {
      const res = await fetch(
        `/api/gym/${activeId}/hyrox-workouts?from=${from}&to=${to}`
      );
      if (!res.ok) throw new Error("Failed to load gym Hyrox workouts");
      return res.json();
    },
  });

  if (!activeId || !flagOn) return null;
  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading your gym&apos;s Hyrox workouts…
        </CardContent>
      </Card>
    );
  }

  const rows = data?.workouts ?? [];
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardContent className="space-y-2 py-4">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Your gym&apos;s Hyrox programming
          </p>
          <span className="text-[11px] text-muted-foreground">This week</span>
        </div>
        <ul className="space-y-1.5">
          {rows.map((w) => (
            <li key={w.id}>
              <Link
                href={`/crossfit?date=${w.workoutDate}&workout=${w.id}`}
                className="flex items-start gap-3 rounded-lg bg-muted/30 px-3 py-2 hover:bg-muted/40"
              >
                <span className="w-16 shrink-0 font-mono text-[11px] text-muted-foreground">
                  {new Date(`${w.workoutDate}T00:00:00`).toLocaleDateString(
                    "en-US",
                    { weekday: "short", month: "short", day: "numeric" }
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {w.title ?? "Hyrox WOD"}
                  </p>
                  {w.description ? (
                    <p className="line-clamp-2 text-[11px] text-muted-foreground">
                      {w.description}
                    </p>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
