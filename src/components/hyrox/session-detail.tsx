"use client";

import { useState } from "react";
import {
  ArrowLeft,
  Clock,
  Target,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  Lightbulb,
  Clipboard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import type { PlanSession, SessionType } from "@/lib/plan-generator";
import { parseTimeToSeconds, formatTime } from "@/lib/hyrox-data";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LogData {
  actualPace?: string;
  distance?: string;
  time?: string;
  reps?: string;
  weight?: string;
  rpe: number;
  notes: string;
}

interface SessionDetailProps {
  session: PlanSession;
  onBack: () => void;
  onLog: (sessionId: string, data: LogData) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SessionDetail({ session, onBack, onLog }: SessionDetailProps) {
  const [logging, setLogging] = useState(false);
  const [logData, setLogData] = useState<LogData>({
    actualPace: "",
    distance: "",
    time: "",
    reps: "",
    weight: "",
    rpe: 7,
    notes: "",
  });
  const [submitted, setSubmitted] = useState(session.status === "completed");

  const handleSubmit = () => {
    onLog(session.id, logData);
    setSubmitted(true);
    setLogging(false);
  };

  // Comparison helper
  const getComparison = (): { label: string; color: string; icon: typeof TrendingUp } | null => {
    if (!submitted || !session.targets.length) return null;

    const targetTime = session.targets.find((t) => t.label === "Target Pace" || t.label === "Target Time");
    if (!targetTime) return null;

    const targetSec = parseTimeToSeconds(targetTime.value.split(" ")[0]);
    let actualSec: number | null = null;

    if (logData.actualPace) actualSec = parseTimeToSeconds(logData.actualPace);
    if (logData.time) actualSec = parseTimeToSeconds(logData.time);

    if (!actualSec || isNaN(actualSec) || isNaN(targetSec)) return null;

    const diff = actualSec - targetSec;
    if (diff < -5) return { label: "Ahead of target", color: "text-green-400", icon: TrendingUp };
    if (diff > 5) return { label: "Behind target", color: "text-amber-400", icon: TrendingDown };
    return { label: "On track", color: "text-blue-400", icon: Minus };
  };

  const comparison = getComparison();

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <p className="text-xs text-muted-foreground">
            {session.dayLabel} — Week {session.weekNumber}
          </p>
          <h2 className="text-lg font-semibold">{session.title}</h2>
        </div>
        {submitted && (
          <Badge variant="default" className="bg-green-500/20 text-green-400">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            Logged
          </Badge>
        )}
      </div>

      {/* Description */}
      <Card>
        <CardContent>
          <p className="text-sm">{session.description}</p>
        </CardContent>
      </Card>

      {/* Targets */}
      {session.targets.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Target className="h-4 w-4" />
              Targets
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {session.targets.map((t, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t.label}</span>
                  <span className="font-mono font-medium">{t.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Technique cues */}
      {session.techniqueCues.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Lightbulb className="h-4 w-4" />
              Technique Cues
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {session.techniqueCues.map((cue, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  {cue}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Comparison */}
      {comparison && (
        <Card className={comparison.color === "text-green-400" ? "ring-green-500/20" : comparison.color === "text-amber-400" ? "ring-amber-500/20" : ""}>
          <CardContent className="flex items-center gap-3 py-3">
            <comparison.icon className={`h-5 w-5 ${comparison.color}`} />
            <span className={`text-sm font-medium ${comparison.color}`}>{comparison.label}</span>
          </CardContent>
        </Card>
      )}

      {/* Log form */}
      {!submitted && !logging && session.type !== "rest" && (
        <Button onClick={() => setLogging(true)} className="w-full">
          <Clipboard className="mr-2 h-4 w-4" />
          Log This Session
        </Button>
      )}

      {logging && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Log Results</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Run-specific fields */}
            {session.type === "run" && (
              <>
                <div className="space-y-1.5">
                  <Label>Actual Pace (MM:SS /km)</Label>
                  <Input
                    placeholder="5:00"
                    value={logData.actualPace}
                    onChange={(e) => setLogData({ ...logData, actualPace: e.target.value })}
                    className="font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Distance (km)</Label>
                  <Input
                    type="number"
                    placeholder="5"
                    value={logData.distance}
                    onChange={(e) => setLogData({ ...logData, distance: e.target.value })}
                    className="font-mono"
                  />
                </div>
              </>
            )}

            {/* Station-specific fields */}
            {session.type === "station" && (
              <>
                <div className="space-y-1.5">
                  <Label>Time (MM:SS)</Label>
                  <Input
                    placeholder="3:30"
                    value={logData.time}
                    onChange={(e) => setLogData({ ...logData, time: e.target.value })}
                    className="font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Reps</Label>
                  <Input
                    type="number"
                    placeholder="100"
                    value={logData.reps}
                    onChange={(e) => setLogData({ ...logData, reps: e.target.value })}
                    className="font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Weight (kg)</Label>
                  <Input
                    type="number"
                    placeholder="20"
                    value={logData.weight}
                    onChange={(e) => setLogData({ ...logData, weight: e.target.value })}
                    className="font-mono"
                  />
                </div>
              </>
            )}

            {/* RPE */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>RPE (Rate of Perceived Exertion)</Label>
                <span className="font-mono text-sm text-primary">{logData.rpe}/10</span>
              </div>
              <Slider
                min={1}
                max={10}
                value={[logData.rpe]}
                onValueChange={(val) => setLogData({ ...logData, rpe: Array.isArray(val) ? val[0] : val })}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>Easy</span>
                <span>Maximal</span>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                placeholder="How did it feel?"
                value={logData.notes}
                onChange={(e) => setLogData({ ...logData, notes: e.target.value })}
                rows={3}
              />
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setLogging(false)} className="flex-1">
                Cancel
              </Button>
              <Button onClick={handleSubmit} className="flex-1">
                <CheckCircle2 className="mr-1 h-4 w-4" />
                Save
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
