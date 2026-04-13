"use client";

import { memo, useState, useMemo, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Activity,
  Dumbbell,
  Trophy,
  Coffee,
  Pencil,
  ArrowLeft,
  Clock,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { usePlanWeeks } from "@/hooks/useHyroxPlan";
import type { SessionDetail, SessionBlock, SessionMovement } from "@/types/hyrox-plan";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

type SessionTypeKey = "run" | "station_skills" | "hyrox_day" | "rest";

const TYPE_CONFIG: Record<
  SessionTypeKey,
  { icon: typeof Activity; color: string; bg: string; label: string }
> = {
  run: { icon: Activity, color: "text-blue-400", bg: "bg-blue-500/10", label: "Run" },
  station_skills: { icon: Dumbbell, color: "text-orange-400", bg: "bg-orange-500/10", label: "Station Skills" },
  hyrox_day: { icon: Trophy, color: "text-violet-400", bg: "bg-violet-500/10", label: "HYROX Day" },
  rest: { icon: Coffee, color: "text-muted-foreground", bg: "bg-white/[0.04]", label: "Rest" },
};

// ---------------------------------------------------------------------------
// Types for API response
// ---------------------------------------------------------------------------

interface PlanWeeksResponse {
  plan: {
    id: string;
    title: string;
    totalWeeks: number;
    startDate: string | null;
    endDate: string | null;
    generationStatus: string;
    trainingPhilosophy: string | null;
  };
  phases: {
    id: string;
    phaseNumber: number;
    name: string;
    description: string;
    startWeek: number;
    endWeek: number;
    focusAreas: string[] | null;
  }[];
  weeks: {
    weekNumber: number;
    phase: {
      id: string;
      phaseNumber: number;
      name: string;
      description: string;
      startWeek: number;
      endWeek: number;
      focusAreas: string[] | null;
    } | null;
    sessions: {
      id: string;
      planId: string;
      week: number;
      dayOfWeek: number;
      sessionType: string;
      title: string;
      description: string;
      targetPace: string | null;
      durationMinutes: number | null;
      phase: string;
      orderInDay: number;
      phaseId: string | null;
      aiGenerated: boolean | null;
      athleteModified: boolean | null;
      originalSessionData: unknown;
      sessionDetail: SessionDetail | null;
      equipmentRequired: string[] | null;
      createdAt: string;
    }[];
  }[];
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PlanViewV2Props {
  planId: string;
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4 animate-pulse">
      {/* Phase bar placeholder */}
      <div className="flex gap-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-2 flex-1 rounded-full bg-muted/50" />
        ))}
      </div>
      {/* Week selector placeholder */}
      <div className="flex items-center justify-between">
        <div className="h-8 w-8 rounded bg-muted/50" />
        <div className="flex flex-col items-center gap-1">
          <div className="h-5 w-24 rounded bg-muted/50" />
          <div className="h-3 w-32 rounded bg-muted/50" />
        </div>
        <div className="h-8 w-8 rounded bg-muted/50" />
      </div>
      {/* Session cards placeholder */}
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-20 rounded-lg bg-muted/50" />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase progress bar
// ---------------------------------------------------------------------------

function PhaseProgressBar({
  phases,
  currentWeek,
}: {
  phases: PlanWeeksResponse["phases"];
  currentWeek: number;
}) {
  if (phases.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1">
        {phases.map((phase) => {
          const isActive = currentWeek >= phase.startWeek && currentWeek <= phase.endWeek;
          const isPast = currentWeek > phase.endWeek;

          return (
            <div
              key={phase.id}
              className="flex flex-col items-center gap-1 flex-1"
            >
              <div
                className={`h-2 w-full rounded-full transition-colors ${
                  isActive
                    ? "bg-primary drop-shadow-[0_0_6px_oklch(0.85_0.20_130_/_30%)]"
                    : isPast
                      ? "bg-primary/40"
                      : "bg-muted/50"
                }`}
              />
              <span
                className={`text-[10px] leading-tight text-center ${
                  isActive ? "text-primary font-medium" : "text-muted-foreground"
                }`}
              >
                {phase.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session card
// ---------------------------------------------------------------------------

const SessionCard = memo(function SessionCard({
  session,
  onSelect,
}: {
  session: PlanWeeksResponse["weeks"][number]["sessions"][number];
  onSelect: (id: string) => void;
}) {
  const config = TYPE_CONFIG[session.sessionType as SessionTypeKey] ?? TYPE_CONFIG.rest;
  const Icon = config.icon;

  return (
    <Card
      className="cursor-pointer transition-all duration-200 hover:ring-1 hover:ring-primary/20"
      size="sm"
      onClick={() => onSelect(session.id)}
    >
      <CardContent className="flex items-center gap-3 py-0">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${config.bg}`}
        >
          <Icon className={`h-4 w-4 ${config.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {DAY_LABELS[session.dayOfWeek] ?? `Day ${session.dayOfWeek}`}
            </span>
            <span className="truncate text-sm font-semibold">{session.title}</span>
            {session.athleteModified && (
              <Badge variant="outline" className="shrink-0 text-[9px] px-1.5 py-0 gap-0.5">
                <Pencil className="h-2.5 w-2.5" />
                edited
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {session.durationMinutes && (
              <span className="flex items-center gap-0.5">
                <Clock className="h-3 w-3" />
                {session.durationMinutes}m
              </span>
            )}
            {session.description && (
              <span className="truncate">{session.description}</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

// ---------------------------------------------------------------------------
// Session detail panel
// ---------------------------------------------------------------------------

function SessionDetailPanel({
  session,
  onBack,
}: {
  session: PlanWeeksResponse["weeks"][number]["sessions"][number];
  onBack: () => void;
}) {
  const detail = session.sessionDetail as SessionDetail | null;
  const config = TYPE_CONFIG[session.sessionType as SessionTypeKey] ?? TYPE_CONFIG.rest;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground">
            {DAY_LABELS[session.dayOfWeek] ?? `Day ${session.dayOfWeek}`} — Week{" "}
            {session.week}
          </p>
          <h2 className="text-lg font-semibold truncate">{session.title}</h2>
        </div>
        {session.athleteModified && (
          <Badge variant="outline" className="shrink-0 text-[10px] gap-1">
            <Pencil className="h-3 w-3" />
            Edited
          </Badge>
        )}
      </div>

      {/* Description */}
      <Card>
        <CardContent>
          <p className="text-sm">{session.description}</p>
        </CardContent>
      </Card>

      {/* Duration + pace */}
      {(session.durationMinutes || session.targetPace) && (
        <div className="flex gap-3">
          {session.durationMinutes && (
            <Badge variant="secondary" className="gap-1">
              <Clock className="h-3 w-3" />
              {session.durationMinutes} min
            </Badge>
          )}
          {session.targetPace && (
            <Badge variant="secondary" className="gap-1">
              <Activity className="h-3 w-3" />
              {session.targetPace}
            </Badge>
          )}
        </div>
      )}

      {/* Equipment required */}
      {session.equipmentRequired && session.equipmentRequired.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Wrench className="h-4 w-4" />
              Equipment Required
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {session.equipmentRequired.map((eq) => (
                <Badge key={eq} variant="outline" className="text-xs">
                  {eq}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Session detail blocks */}
      {detail && (
        <>
          {/* Warmup */}
          {detail.warmup && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Warmup</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-line">
                  {detail.warmup}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Blocks */}
          {detail.blocks.map((block: SessionBlock, blockIdx: number) => (
            <Card key={blockIdx}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{block.label}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {block.movements.map(
                  (movement: SessionMovement, movIdx: number) => (
                    <div key={movIdx} className="space-y-0.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium">
                          {movement.name}
                        </span>
                        <span className="text-xs font-mono text-muted-foreground shrink-0">
                          {movement.prescription}
                        </span>
                      </div>
                      {movement.rest && (
                        <p className="text-[11px] text-muted-foreground">
                          Rest: {movement.rest}
                        </p>
                      )}
                      {movement.notes && (
                        <p className="text-[11px] text-muted-foreground italic">
                          {movement.notes}
                        </p>
                      )}
                    </div>
                  )
                )}
              </CardContent>
            </Card>
          ))}

          {/* Cooldown */}
          {detail.cooldown && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Cooldown</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-line">
                  {detail.cooldown}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Coach notes */}
          {detail.coachNotes && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Coach Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-line">
                  {detail.coachNotes}
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Edit button */}
      <Button variant="outline" className="w-full" disabled>
        <Pencil className="mr-2 h-4 w-4" />
        Edit Session
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PlanViewV2({ planId }: PlanViewV2Props) {
  const { data, isLoading, error } = usePlanWeeks(planId) as {
    data: PlanWeeksResponse | undefined;
    isLoading: boolean;
    error: Error | null;
  };

  const [weekIndex, setWeekIndex] = useState(0);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const prevWeek = useCallback(
    () => setWeekIndex((i) => Math.max(0, i - 1)),
    []
  );
  const nextWeek = useCallback(
    () =>
      setWeekIndex((i) =>
        data ? Math.min(data.weeks.length - 1, i + 1) : i
      ),
    [data]
  );

  const handleSelectSession = useCallback((id: string) => {
    setSelectedSessionId(id);
  }, []);

  const handleBackFromDetail = useCallback(() => {
    setSelectedSessionId(null);
  }, []);

  // Find the selected session across all weeks
  const selectedSession = useMemo(() => {
    if (!selectedSessionId || !data) return null;
    for (const week of data.weeks) {
      const found = week.sessions.find((s) => s.id === selectedSessionId);
      if (found) return found;
    }
    return null;
  }, [selectedSessionId, data]);

  // Loading state
  if (isLoading) {
    return <LoadingSkeleton />;
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <p className="text-sm text-muted-foreground">
          Failed to load training plan.
        </p>
        <p className="text-xs text-muted-foreground">{error.message}</p>
      </div>
    );
  }

  if (!data) return null;

  // Plan still generating
  if (
    data.plan.generationStatus === "pending" ||
    data.plan.generationStatus === "generating"
  ) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm font-medium">Generating your training plan...</p>
        <p className="text-xs text-muted-foreground">
          This may take a minute. The page will update automatically.
        </p>
      </div>
    );
  }

  // Generation failed
  if (data.plan.generationStatus === "failed") {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <p className="text-sm text-muted-foreground">
          Plan generation failed. Please try again.
        </p>
      </div>
    );
  }

  // Session detail view
  if (selectedSession) {
    return (
      <SessionDetailPanel
        session={selectedSession}
        onBack={handleBackFromDetail}
      />
    );
  }

  // Plan view
  const week = data.weeks[weekIndex];
  if (!week) return null;

  return (
    <div className="flex flex-col gap-4">
      {/* Phase progress bar */}
      <PhaseProgressBar phases={data.phases} currentWeek={week.weekNumber} />

      {/* Week selector */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={prevWeek}
          disabled={weekIndex === 0}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-center">
          <p className="font-bold">Week {week.weekNumber}</p>
          {week.phase && (
            <p className="text-xs text-muted-foreground">{week.phase.name}</p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={nextWeek}
          disabled={weekIndex === data.weeks.length - 1}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Day grid */}
      <div className="space-y-2">
        {week.sessions.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-4">
            No sessions for this week yet.
          </p>
        ) : (
          week.sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              onSelect={handleSelectSession}
            />
          ))
        )}
      </div>
    </div>
  );
}
