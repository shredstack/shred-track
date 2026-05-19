"use client";

// Committed Club leaderboard (spec §2.5). Shows top members by attended
// classes for the current month (live) or any historical month
// (snapshot). Members only.

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGymContext } from "@/hooks/useGymContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GymToolHeader } from "@/components/gym/gym-tool-header";
import { Trophy } from "lucide-react";

interface LeaderboardRow {
  userId: string;
  userName: string;
  userImage: string | null;
  classesAttended: number;
  rank: number;
  qualified: boolean;
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function previousMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function CommittedClubPage() {
  const { data: ctx } = useGymContext();
  const activeId = ctx?.activeCommunityId ?? null;
  const [yearMonth, setYearMonth] = useState("");
  const { data, isLoading } = useQuery<{
    yearMonth: string;
    rows: LeaderboardRow[];
  }>({
    queryKey: ["committed-club", activeId, yearMonth],
    enabled: !!activeId,
    queryFn: async () => {
      const q = yearMonth ? `?yearMonth=${yearMonth}` : "";
      const res = await fetch(`/api/gym/${activeId}/committed-club${q}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  if (!activeId) return <p className="text-sm">Pick a gym.</p>;
  const ym = data?.yearMonth ?? yearMonth;

  return (
    <div className="space-y-4">
      <GymToolHeader
        icon={Trophy}
        label="Committed Club"
        description="Monthly leaderboard for class attendance"
      />
      <div className="flex items-center justify-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setYearMonth(previousMonth(ym))}
          disabled={!ym}
        >
          ←
        </Button>
        <span className="text-sm">{ym ? monthLabel(ym) : "—"}</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setYearMonth(nextMonth(ym))}
          disabled={!ym}
        >
          →
        </Button>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data?.rows.length ? (
        <p className="text-sm text-muted-foreground">
          No qualifying attendance yet.
        </p>
      ) : (
        data.rows.map((r) => (
          <Card key={r.userId}>
            <CardContent className="flex items-center gap-3 py-3">
              <div className="w-8 shrink-0 text-center font-bold">#{r.rank}</div>
              {r.userImage ? (
                <img
                  src={r.userImage}
                  alt=""
                  className="size-8 rounded-full object-cover"
                />
              ) : (
                <div className="flex size-8 items-center justify-center rounded-full bg-muted text-xs">
                  {r.userName.slice(0, 1)}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{r.userName}</p>
                <p className="text-xs text-muted-foreground">
                  {r.classesAttended} classes
                </p>
              </div>
              {r.qualified && <Badge>🏆 In</Badge>}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
