"use client";

import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Trash2,
  ChevronUp,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { MovementSearch } from "@/components/crossfit/movement-search";
import type {
  WorkoutBuilderMovement,
  MovementOption,
} from "@/types/crossfit";
import { useState } from "react";

function generateTempId() {
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface MovementListBuilderProps {
  movements: WorkoutBuilderMovement[];
  onChange: (movements: WorkoutBuilderMovement[]) => void;
}

export function MovementListBuilder({
  movements,
  onChange,
}: MovementListBuilderProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpanded = useCallback((tempId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(tempId)) next.delete(tempId);
      else next.add(tempId);
      return next;
    });
  }, []);

  const addMovement = useCallback(
    (movement: MovementOption) => {
      const newMovement: WorkoutBuilderMovement = {
        tempId: generateTempId(),
        movementId: movement.id,
        movementName: movement.canonicalName,
        category: movement.category,
        isWeighted: movement.isWeighted,
        prescribedReps: "",
        prescribedWeightMale: movement.commonRxWeightMale || "",
        prescribedWeightFemale: movement.commonRxWeightFemale || "",
        rxStandard: "",
        notes: "",
      };
      onChange([...movements, newMovement]);
    },
    [movements, onChange]
  );

  const addCustomMovement = useCallback(
    (name: string) => {
      const newMovement: WorkoutBuilderMovement = {
        tempId: generateTempId(),
        movementName: name,
        isWeighted: false,
        prescribedReps: "",
        prescribedWeightMale: "",
        prescribedWeightFemale: "",
        rxStandard: "",
        notes: "",
      };
      onChange([...movements, newMovement]);
    },
    [movements, onChange]
  );

  const updateMovement = useCallback(
    (tempId: string, updates: Partial<WorkoutBuilderMovement>) => {
      onChange(
        movements.map((m) => (m.tempId === tempId ? { ...m, ...updates } : m))
      );
    },
    [movements, onChange]
  );

  const removeMovement = useCallback(
    (tempId: string) => {
      onChange(movements.filter((m) => m.tempId !== tempId));
    },
    [movements, onChange]
  );

  const moveMovement = useCallback(
    (tempId: string, direction: "up" | "down") => {
      const idx = movements.findIndex((m) => m.tempId === tempId);
      if (idx === -1) return;
      if (direction === "up" && idx === 0) return;
      if (direction === "down" && idx === movements.length - 1) return;

      const newMovements = [...movements];
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      [newMovements[idx], newMovements[swapIdx]] = [
        newMovements[swapIdx],
        newMovements[idx],
      ];
      onChange(newMovements);
    },
    [movements, onChange]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-base font-semibold">Movements</Label>
        <span className="text-xs text-muted-foreground">
          {movements.length} movement{movements.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Movement list */}
      <div className="space-y-2">
        {movements.map((mov, idx) => {
          const isExpanded = expandedIds.has(mov.tempId);
          return (
            <div
              key={mov.tempId}
              className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-2"
            >
              {/* Header row */}
              <div className="flex items-center gap-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                  {idx + 1}
                </span>
                <button
                  type="button"
                  className="flex flex-1 items-center gap-1 text-left"
                  onClick={() => toggleExpanded(mov.tempId)}
                >
                  <span className="flex-1 font-medium text-sm">
                    {mov.movementName}
                  </span>
                  <ChevronRight
                    className={`size-3.5 text-muted-foreground transition-transform ${
                      isExpanded ? "rotate-90" : ""
                    }`}
                  />
                </button>
                <div className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => moveMovement(mov.tempId, "up")}
                    disabled={idx === 0}
                  >
                    <ChevronUp className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => moveMovement(mov.tempId, "down")}
                    disabled={idx === movements.length - 1}
                  >
                    <ChevronDown className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => removeMovement(mov.tempId)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>

              {/* Reps row — always visible */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Reps</Label>
                <Input
                  value={mov.prescribedReps}
                  onChange={(e) =>
                    updateMovement(mov.tempId, {
                      prescribedReps: e.target.value,
                    })
                  }
                  placeholder="e.g. 21-15-9, 15, 400m"
                  className="h-7 text-xs"
                />
              </div>

              {/* Expanded fields */}
              {isExpanded && (
                <div className="space-y-2 pt-1">
                  {mov.isWeighted && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">
                          Rx Weight (M)
                        </Label>
                        <Input
                          value={mov.prescribedWeightMale}
                          onChange={(e) =>
                            updateMovement(mov.tempId, {
                              prescribedWeightMale: e.target.value,
                            })
                          }
                          placeholder="e.g. 135"
                          className="h-7 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">
                          Rx Weight (F)
                        </Label>
                        <Input
                          value={mov.prescribedWeightFemale}
                          onChange={(e) =>
                            updateMovement(mov.tempId, {
                              prescribedWeightFemale: e.target.value,
                            })
                          }
                          placeholder="e.g. 95"
                          className="h-7 text-xs"
                        />
                      </div>
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Rx Standard / Notes
                    </Label>
                    <Input
                      value={mov.rxStandard}
                      onChange={(e) =>
                        updateMovement(mov.tempId, {
                          rxStandard: e.target.value,
                        })
                      }
                      placeholder="e.g. Full squat, Chest to deck"
                      className="h-7 text-xs"
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Movement search / add */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Add Movement</Label>
        <MovementSearch
          onSelect={addMovement}
          onAddNew={addCustomMovement}
          placeholder="Search or type a movement name..."
        />
      </div>
    </div>
  );
}
