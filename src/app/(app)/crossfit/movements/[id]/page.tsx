"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Dumbbell,
  ExternalLink,
  Loader2,
  Video,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import {
  MOVEMENT_CATEGORY_COLORS,
  type MovementCategory,
} from "@/types/crossfit";
import type { MovementHistoryEntry } from "@/app/api/movements/[id]/history/route";

interface MovementDetail {
  id: string;
  canonicalName: string;
  category: string;
  isWeighted: boolean;
  is1rmApplicable: boolean;
  metricType: string;
  commonRxWeightMale: string | null;
  commonRxWeightFemale: string | null;
  videoUrl: string | null;
}

interface HistoryResponse {
  movement: MovementDetail;
  logs: MovementHistoryEntry[];
}

function useMovementHistory(id: string) {
  return useQuery<HistoryResponse>({
    queryKey: ["movement-history", id],
    queryFn: async () => {
      const res = await fetch(`/api/movements/${id}/history`);
      if (res.status === 404) throw new Error("Not found");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });
}

function formatDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function summarizeLog(log: MovementHistoryEntry, isWeighted: boolean): string {
  if (isWeighted) {
    if (log.actualWeight) return `${log.actualWeight} lb`;
    if (log.setEntries && log.setEntries.length > 0) {
      const repsVary = log.setEntries.some(
        (e, _i, arr) => e.reps != null && e.reps !== arr[0].reps
      );
      return (
        log.setEntries
          .map((e) =>
            repsVary && e.reps != null
              ? `${e.weight}×${e.reps}`
              : `${e.weight}`
          )
          .join(" / ") + " lb"
      );
    }
    return "—";
  }
  if (log.actualReps) return `${log.actualReps} reps`;
  return "—";
}

export default function MovementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, isLoading, isError } = useMovementHistory(id);

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10">
          <p className="text-sm text-muted-foreground">Movement not found.</p>
          <Link
            href="/crossfit/movements"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ArrowLeft className="size-4" />
            Back to movements
          </Link>
        </CardContent>
      </Card>
    );
  }

  const { movement, logs } = data;
  const totalLogs = logs.length;
  const rxLogs = logs.filter((l) => l.wasRx).length;
  const rxPct = totalLogs > 0 ? Math.round((rxLogs / totalLogs) * 100) : null;

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/crossfit/movements"
        className={buttonVariants({ variant: "ghost", size: "sm" }) + " self-start -ml-2"}
      >
        <ArrowLeft className="size-4" />
        Movements
      </Link>

      <Card className="gradient-border overflow-visible">
        <CardContent className="flex flex-col gap-3 py-5 bg-mesh rounded-xl">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-violet-500/10">
              <Dumbbell className="h-5 w-5 text-violet-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold leading-tight">
                {movement.canonicalName}
              </h1>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge
                  variant="outline"
                  className={`text-[10px] ${MOVEMENT_CATEGORY_COLORS[movement.category as MovementCategory] || ""}`}
                >
                  {movement.category}
                </Badge>
                {movement.is1rmApplicable && (
                  <Badge variant="outline" className="text-[10px]">
                    1RM
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {(movement.commonRxWeightMale || movement.commonRxWeightFemale) && (
            <p className="text-xs text-muted-foreground">
              Common Rx: {movement.commonRxWeightMale || "—"}/
              {movement.commonRxWeightFemale || "—"} lb (M/F)
            </p>
          )}

          {movement.videoUrl && (
            <a
              href={movement.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "outline", size: "sm" }) + " self-start"}
            >
              <Video className="size-4" />
              Watch demo
              <ExternalLink className="size-3" />
            </a>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-2">
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-2xl font-bold">{totalLogs}</p>
            <p className="text-[10px] uppercase text-muted-foreground tracking-wider">
              Logs
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-2xl font-bold">
              {rxPct !== null ? `${rxPct}%` : "—"}
            </p>
            <p className="text-[10px] uppercase text-muted-foreground tracking-wider">
              Rx
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-2xl font-bold">
              {logs[0] ? formatDate(logs[0].workoutDate).split(",")[0] : "—"}
            </p>
            <p className="text-[10px] uppercase text-muted-foreground tracking-wider">
              Last
            </p>
          </CardContent>
        </Card>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          History
        </p>
        {totalLogs === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-8">
              <p className="text-sm text-muted-foreground text-center">
                You haven&apos;t logged this movement yet.
              </p>
              <p className="text-xs text-muted-foreground text-center max-w-xs">
                Log a workout that includes {movement.canonicalName} to start
                tracking your progression.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => (
              <Card key={log.detailId}>
                <CardContent className="flex items-center justify-between gap-2 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">
                        {summarizeLog(log, movement.isWeighted)}
                      </span>
                      <Badge
                        variant={log.wasRx ? "secondary" : "outline"}
                        className="text-[10px]"
                      >
                        {log.wasRx ? "Rx" : "Scaled"}
                      </Badge>
                      {log.modification && (
                        <span className="text-[11px] text-muted-foreground">
                          {log.modification}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {formatDate(log.workoutDate)}
                      {log.workoutTitle ? ` · ${log.workoutTitle}` : ""}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
