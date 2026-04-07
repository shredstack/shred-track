"use client";

import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Activity,
  Dumbbell,
  Zap,
  BedDouble,
  CheckCircle2,
  SkipForward,
  AlertCircle,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { GeneratedPlan, PlanSession, PlanWeek, SessionType } from "@/lib/plan-generator";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TYPE_CONFIG: Record<SessionType, { icon: typeof Activity; color: string; bg: string }> = {
  run: { icon: Activity, color: "text-blue-400", bg: "bg-blue-500/10" },
  station: { icon: Dumbbell, color: "text-orange-400", bg: "bg-orange-500/10" },
  hyrox_class: { icon: Zap, color: "text-purple-400", bg: "bg-purple-500/10" },
  rest: { icon: BedDouble, color: "text-muted-foreground", bg: "bg-muted/30" },
};

const STATUS_STYLES: Record<string, { badge: "default" | "secondary" | "outline" | "destructive"; text: string }> = {
  upcoming: { badge: "outline", text: "Upcoming" },
  completed: { badge: "default", text: "Done" },
  skipped: { badge: "secondary", text: "Skipped" },
  missed: { badge: "destructive", text: "Missed" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PlanViewProps {
  plan: GeneratedPlan;
  onSelectSession: (session: PlanSession) => void;
  onUpdateSession: (sessionId: string, updates: Partial<PlanSession>) => void;
}

export function PlanView({ plan, onSelectSession, onUpdateSession }: PlanViewProps) {
  const [weekIndex, setWeekIndex] = useState(0);
  const week = plan.weeks[weekIndex];

  const prevWeek = () => setWeekIndex(Math.max(0, weekIndex - 1));
  const nextWeek = () => setWeekIndex(Math.min(plan.weeks.length - 1, weekIndex + 1));

  const completedCount = week.sessions.filter((s) => s.status === "completed").length;
  const totalNonRest = week.sessions.filter((s) => s.type !== "rest").length;

  return (
    <div className="flex flex-col gap-4">
      {/* Week selector */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="icon" onClick={prevWeek} disabled={weekIndex === 0}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="text-center">
          <p className="font-semibold">{week.label}</p>
          <p className="text-xs text-muted-foreground">{week.focus}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={nextWeek}
          disabled={weekIndex === plan.weeks.length - 1}
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      {/* Week progress */}
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-green-500 transition-all"
            style={{ width: `${totalNonRest ? (completedCount / totalNonRest) * 100 : 0}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {completedCount}/{totalNonRest}
        </span>
      </div>

      {/* Day grid */}
      <div className="space-y-2">
        {week.sessions.map((session) => {
          const config = TYPE_CONFIG[session.type];
          const Icon = config.icon;
          const statusStyle = STATUS_STYLES[session.status];

          return (
            <Card
              key={session.id}
              className={`cursor-pointer transition-colors hover:ring-primary/30 ${
                session.status === "completed"
                  ? "ring-green-500/20"
                  : session.status === "missed"
                    ? "ring-amber-500/20"
                    : session.status === "skipped"
                      ? "opacity-60"
                      : ""
              }`}
              size="sm"
              onClick={() => onSelectSession(session)}
            >
              <CardContent className="flex items-center gap-3 py-0">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${config.bg}`}>
                  <Icon className={`h-4 w-4 ${config.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">{session.dayLabel}</span>
                    <span className="truncate text-sm font-medium">{session.title}</span>
                  </div>
                  {session.targets.length > 0 && (
                    <p className="truncate text-xs text-muted-foreground">
                      {session.targets.map((t) => `${t.label}: ${t.value}`).join(" · ")}
                    </p>
                  )}
                </div>
                <Badge variant={statusStyle.badge} className="shrink-0 text-[10px]">
                  {session.status === "completed" && <CheckCircle2 className="mr-0.5 h-3 w-3" />}
                  {statusStyle.text}
                </Badge>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
