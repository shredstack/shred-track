"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Heart, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useGymContext } from "@/hooks/useGymContext";

interface AdherenceAthlete {
  userId: string;
  name: string;
  email: string;
  isCoach: boolean;
  isAdmin: boolean;
  sessionsStarted: number;
  sessionsCompleted: number;
  skippedItems: number;
  lastSessionDate: string | null;
}

interface AdherenceResponse {
  weeks: number;
  startDate: string;
  endDate: string;
  athletes: AdherenceAthlete[];
}

function useGymAdherence(communityId: string | null, weeks: number) {
  return useQuery<AdherenceResponse>({
    queryKey: ["gym-recovery-adherence", communityId, weeks],
    enabled: !!communityId,
    queryFn: async () => {
      const res = await fetch(
        `/api/gym/${communityId}/recovery/adherence?weeks=${weeks}`
      );
      if (!res.ok) throw new Error("Failed to load adherence");
      return res.json();
    },
  });
}

export default function GymRecoveryPage() {
  const { data: ctx } = useGymContext();
  const communityId = ctx?.activeCommunityId ?? null;
  const { data, isLoading } = useGymAdherence(communityId, 4);

  return (
    <div className="space-y-4">
      <Link
        href="/gym"
        className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5 mr-1" />
        Gym tools
      </Link>

      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Heart className="h-5 w-5 text-rose-400" />
          Recovery adherence
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Per-athlete recovery completion over the last{" "}
          {data?.weeks ?? 4} weeks.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : !data || data.athletes.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No active athletes in this gym yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {data.athletes.map((a) => (
            <AthleteRow key={a.userId} athlete={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function AthleteRow({ athlete }: { athlete: AdherenceAthlete }) {
  const completion = athlete.sessionsCompleted;
  const tone =
    completion >= 8
      ? "text-emerald-500"
      : completion >= 4
        ? "text-amber-500"
        : athlete.sessionsStarted > 0
          ? "text-muted-foreground"
          : "text-muted-foreground/60";
  return (
    <Card>
      <CardContent className="py-3 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium truncate">
              {athlete.name || athlete.email}
            </p>
            {(athlete.isAdmin || athlete.isCoach) && (
              <Badge variant="outline" className="text-[10px]">
                {athlete.isAdmin ? "admin" : "coach"}
              </Badge>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground truncate">
            {athlete.email}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {athlete.lastSessionDate
              ? `Last session ${athlete.lastSessionDate}`
              : "No sessions in window"}
            {athlete.skippedItems > 0
              ? ` · ${athlete.skippedItems} skipped`
              : ""}
          </p>
        </div>
        <div className={`text-right ${tone}`}>
          <p className="text-lg font-bold leading-none">{completion}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            done
          </p>
          {athlete.sessionsStarted > completion && (
            <p className="text-[10px] text-muted-foreground">
              {athlete.sessionsStarted - completion} in-prog
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
