"use client";

import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { RecoveryPrescription } from "@/types/recovery";

export interface PrescriptionRowItem {
  /** Stable client-side id; tempId for new rows, real id for existing. */
  key: string;
  movementName?: string;
  routineName?: string;
  isRoutine?: boolean;
  prescription: RecoveryPrescription;
  notes: string;
}

/**
 * Single row in a builder list — renders the up/down arrows, item label,
 * delete button, sets/reps/hold inputs, and a notes input. Used by both
 * the schedule and routine builders so the per-row layout stays in sync.
 */
export function PrescriptionRow({
  item,
  index,
  total,
  onMove,
  onRemove,
  onPrescriptionChange,
  onNotesChange,
  showPrescriptionInputs = true,
}: {
  item: PrescriptionRowItem;
  index: number;
  total: number;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onPrescriptionChange: (next: RecoveryPrescription) => void;
  onNotesChange: (notes: string) => void;
  /**
   * Routines in the schedule builder don't show their own prescription
   * inputs — the slot just points to the routine. Pass false there.
   */
  showPrescriptionInputs?: boolean;
}) {
  const rx = item.prescription;
  return (
    <Card>
      <CardContent className="py-3 space-y-2">
        <div className="flex items-start gap-2">
          <div className="flex flex-col gap-1">
            <button
              onClick={() => onMove(-1)}
              disabled={index === 0}
              className="text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              onClick={() => onMove(1)}
              disabled={index === total - 1}
              className="text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">
              {item.movementName ?? item.routineName}
            </p>
            {item.isRoutine && (
              <Badge variant="secondary" className="text-[9px] mt-0.5">
                Routine
              </Badge>
            )}
          </div>
          <button
            onClick={onRemove}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        {showPrescriptionInputs && (
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-[10px]">Sets</Label>
              <Input
                type="number"
                value={rx.sets ?? ""}
                onChange={(e) =>
                  onPrescriptionChange({
                    ...rx,
                    sets: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
              />
            </div>
            <div>
              <Label className="text-[10px]">Reps</Label>
              <Input
                type="number"
                value={rx.reps ?? ""}
                onChange={(e) =>
                  onPrescriptionChange({
                    ...rx,
                    reps: e.target.value ? Number(e.target.value) : undefined,
                    durationSeconds: undefined,
                  })
                }
              />
            </div>
            <div>
              <Label className="text-[10px]">Hold (s)</Label>
              <Input
                type="number"
                value={rx.durationSeconds ?? ""}
                onChange={(e) =>
                  onPrescriptionChange({
                    ...rx,
                    durationSeconds: e.target.value
                      ? Number(e.target.value)
                      : undefined,
                    reps: undefined,
                  })
                }
              />
            </div>
          </div>
        )}
        <Input
          placeholder="Notes…"
          value={item.notes}
          onChange={(e) => onNotesChange(e.target.value)}
        />
      </CardContent>
    </Card>
  );
}
