"use client";

import { useState, useCallback } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sparkles,
  Save,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
} from "lucide-react";
import { parseWorkoutText, formatTime } from "@/lib/workout-parser";
import type {
  ParsedWorkout,
  ParsedMovement,
  WorkoutType,
} from "@/types/crossfit";
import {
  WORKOUT_TYPES,
  WORKOUT_TYPE_LABELS,
  WORKOUT_TYPE_COLORS,
} from "@/types/crossfit";

// ============================================
// Props
// ============================================

interface WorkoutParserProps {
  onSave?: (parsed: ParsedWorkout) => void;
  onCancel?: () => void;
}

// ============================================
// Confidence Indicator
// ============================================

function ConfidenceBadge({ confidence }: { confidence: number }) {
  if (confidence >= 0.8) {
    return (
      <Badge variant="outline" className="gap-1 bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px]">
        <CheckCircle2 className="size-3" />
        High
      </Badge>
    );
  }
  if (confidence >= 0.5) {
    return (
      <Badge variant="outline" className="gap-1 bg-amber-500/10 text-amber-400 border-amber-500/30 text-[10px]">
        <AlertTriangle className="size-3" />
        Medium
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 bg-red-500/10 text-red-400 border-red-500/30 text-[10px]">
      <AlertTriangle className="size-3" />
      Low
    </Badge>
  );
}

// ============================================
// Component
// ============================================

export function WorkoutParser({ onSave, onCancel }: WorkoutParserProps) {
  const [rawText, setRawText] = useState("");
  const [parsed, setParsed] = useState<ParsedWorkout | null>(null);

  const handleParse = useCallback(() => {
    if (!rawText.trim()) return;
    const result = parseWorkoutText(rawText);
    setParsed(result);
  }, [rawText]);

  const handleReset = useCallback(() => {
    setParsed(null);
    setRawText("");
  }, []);

  const updateParsedField = useCallback(
    <K extends keyof ParsedWorkout>(key: K, value: ParsedWorkout[K]) => {
      setParsed((prev) => (prev ? { ...prev, [key]: value } : null));
    },
    []
  );

  const updateMovement = useCallback(
    (idx: number, updates: Partial<ParsedMovement>) => {
      setParsed((prev) => {
        if (!prev) return null;
        const newMovements = [...prev.movements];
        newMovements[idx] = { ...newMovements[idx], ...updates };
        return { ...prev, movements: newMovements };
      });
    },
    []
  );

  const removeMovement = useCallback((idx: number) => {
    setParsed((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        movements: prev.movements.filter((_, i) => i !== idx),
      };
    });
  }, []);

  const handleSave = () => {
    if (parsed) {
      onSave?.(parsed);
    }
  };

  // ---- Paste / Parse View ----
  if (!parsed) {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="wp-raw" className="text-base font-semibold">
            Paste Workout
          </Label>
          <p className="text-xs text-muted-foreground">
            Paste your gym&apos;s workout text and we&apos;ll parse it into a structured format.
          </p>
          <Textarea
            id="wp-raw"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={`Paste your gym's workout here...

Example:
Fran
For Time
21-15-9
Thrusters (95/65)
Pull-Ups

Time Cap: 10 min`}
            rows={10}
            className="font-mono text-sm"
          />
        </div>

        <div className="flex gap-2">
          <Button
            onClick={handleParse}
            disabled={!rawText.trim()}
            className="flex-1"
          >
            <Sparkles className="size-4" />
            Parse Workout
          </Button>
          {onCancel && (
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ---- Parsed Results View ----
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Parsed Workout</h3>
          <p className="text-xs text-muted-foreground">
            Review and edit the parsed fields below. Low-confidence fields are highlighted.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={handleReset}>
          <RotateCcw className="size-3.5" />
          Start Over
        </Button>
      </div>

      {/* Title */}
      <div className="space-y-2">
        <Label htmlFor="wp-title">Title</Label>
        <Input
          id="wp-title"
          value={parsed.title || ""}
          onChange={(e) => updateParsedField("title", e.target.value || undefined)}
          placeholder="Workout title (optional)"
        />
      </div>

      {/* Workout Type */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label>Workout Type</Label>
          <ConfidenceBadge confidence={parsed.workoutTypeConfidence} />
        </div>
        <Select
          value={parsed.workoutType}
          onValueChange={(val) =>
            updateParsedField("workoutType", val as WorkoutType)
          }
        >
          <SelectTrigger
            className={`w-full ${
              parsed.workoutTypeConfidence < 0.5
                ? "border-amber-500/50 ring-1 ring-amber-500/20"
                : ""
            }`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WORKOUT_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                <span className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`text-[9px] ${WORKOUT_TYPE_COLORS[type]}`}
                  >
                    {WORKOUT_TYPE_LABELS[type]}
                  </Badge>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Time Cap / Duration */}
      <div className="grid gap-4 sm:grid-cols-2">
        {(parsed.workoutType === "for_time" || parsed.workoutType === "emom") && (
          <div className="space-y-2">
            <Label htmlFor="wp-tc">
              {parsed.workoutType === "emom" ? "Duration (seconds)" : "Time Cap (seconds)"}
            </Label>
            <Input
              id="wp-tc"
              type="number"
              value={parsed.timeCapSeconds || ""}
              onChange={(e) =>
                updateParsedField(
                  "timeCapSeconds",
                  e.target.value ? parseInt(e.target.value) : undefined
                )
              }
              placeholder={parsed.workoutType === "emom" ? "e.g. 600" : "e.g. 1200"}
            />
            {parsed.timeCapSeconds && (
              <p className="text-xs text-muted-foreground">
                = {formatTime(parsed.timeCapSeconds)}
              </p>
            )}
          </div>
        )}

        {parsed.workoutType === "amrap" && (
          <div className="space-y-2">
            <Label htmlFor="wp-amrap">AMRAP Duration (seconds)</Label>
            <Input
              id="wp-amrap"
              type="number"
              value={parsed.amrapDurationSeconds || ""}
              onChange={(e) =>
                updateParsedField(
                  "amrapDurationSeconds",
                  e.target.value ? parseInt(e.target.value) : undefined
                )
              }
              placeholder="e.g. 720"
            />
            {parsed.amrapDurationSeconds && (
              <p className="text-xs text-muted-foreground">
                = {formatTime(parsed.amrapDurationSeconds)}
              </p>
            )}
          </div>
        )}

        {parsed.repScheme && (
          <div className="space-y-2">
            <Label htmlFor="wp-reps">Rep Scheme</Label>
            <Input
              id="wp-reps"
              value={parsed.repScheme}
              onChange={(e) => updateParsedField("repScheme", e.target.value)}
            />
          </div>
        )}
      </div>

      <Separator />

      {/* Movements */}
      <div className="space-y-3">
        <Label className="text-base font-semibold">
          Movements ({parsed.movements.length})
        </Label>

        {parsed.movements.map((mov, idx) => (
          <div
            key={idx}
            className={`rounded-lg border p-3 space-y-2 ${
              mov.confidence < 0.5
                ? "border-amber-500/50 bg-amber-500/5"
                : "border-border/50 bg-muted/30"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary">
                {idx + 1}
              </span>
              <ConfidenceBadge confidence={mov.confidence} />
              <div className="flex-1" />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => removeMovement(idx)}
                className="text-destructive hover:text-destructive"
              >
                <span className="sr-only">Remove</span>
                &times;
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Movement Name
                </Label>
                <Input
                  value={mov.matchedCanonicalName || mov.name}
                  onChange={(e) =>
                    updateMovement(idx, {
                      matchedCanonicalName: e.target.value,
                      name: e.target.value,
                    })
                  }
                  className={`h-7 text-xs ${
                    mov.confidence < 0.5 ? "border-amber-500/50" : ""
                  }`}
                />
                {mov.matchedCanonicalName &&
                  mov.matchedCanonicalName !== mov.name && (
                    <p className="text-[10px] text-muted-foreground">
                      Original: &quot;{mov.name}&quot;
                    </p>
                  )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Reps</Label>
                <Input
                  value={mov.reps || ""}
                  onChange={(e) =>
                    updateMovement(idx, { reps: e.target.value || undefined })
                  }
                  placeholder="e.g. 21"
                  className="h-7 text-xs"
                />
              </div>
            </div>

            {(mov.weightMale !== undefined || mov.weightFemale !== undefined) && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Weight M ({mov.weightUnit || "lb"})
                  </Label>
                  <Input
                    type="number"
                    value={mov.weightMale ?? ""}
                    onChange={(e) =>
                      updateMovement(idx, {
                        weightMale: e.target.value
                          ? parseFloat(e.target.value)
                          : undefined,
                      })
                    }
                    className="h-7 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Weight F ({mov.weightUnit || "lb"})
                  </Label>
                  <Input
                    type="number"
                    value={mov.weightFemale ?? ""}
                    onChange={(e) =>
                      updateMovement(idx, {
                        weightFemale: e.target.value
                          ? parseFloat(e.target.value)
                          : undefined,
                      })
                    }
                    className="h-7 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Unit</Label>
                  <Select
                    value={mov.weightUnit || "lb"}
                    onValueChange={(val) =>
                      updateMovement(idx, {
                        weightUnit: val as "lb" | "kg",
                      })
                    }
                  >
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lb">lb</SelectItem>
                      <SelectItem value="kg">kg</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
        ))}

        {parsed.movements.length === 0 && (
          <div className="rounded-lg border border-dashed border-border/50 p-6 text-center text-sm text-muted-foreground">
            No movements were detected. The text may need manual entry.
          </div>
        )}
      </div>

      <Separator />

      {/* Raw Text Reference */}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          View raw text
        </summary>
        <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/50 p-3 font-mono text-xs text-muted-foreground">
          {parsed.rawText}
        </pre>
      </details>

      {/* Actions */}
      <div className="flex gap-2">
        <Button onClick={handleSave} className="flex-1">
          <Save className="size-4" />
          Save Workout
        </Button>
        {onCancel && (
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
