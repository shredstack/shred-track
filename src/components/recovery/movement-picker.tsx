"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useRecoveryMovements } from "@/hooks/useRecoveryMovements";
import { useRecoveryRoutines } from "@/hooks/useRecoveryRoutines";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { RecoveryPrescription } from "@/types/recovery";

export interface PickedMovement {
  movementId: string;
  movementName: string;
  isPerSide: boolean;
  defaultPrescription: RecoveryPrescription;
}

export interface PickedRoutine {
  routineId: string;
  routineName: string;
}

/**
 * Shared search-and-pick UI for recovery builders. The schedule builder
 * picks both movements and routines; the routine builder only picks
 * movements (so pass `includeRoutines={false}`).
 */
export function MovementPicker({
  onAddMovement,
  onAddRoutine,
  includeRoutines = true,
  buttonLabel = "Add movement",
}: {
  onAddMovement: (m: PickedMovement) => void;
  onAddRoutine?: (r: PickedRoutine) => void;
  includeRoutines?: boolean;
  buttonLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim(), 250);
  // Server-side search guarantees that movements added since the picker mounted
  // (e.g. just now in another tab, or by an admin) are still findable — pure
  // client filtering of a stale cache returns "no matches" for them.
  const { data: movements, refetch: refetchMovements } = useRecoveryMovements({
    q: debouncedSearch || undefined,
  });
  const { data: routines, refetch: refetchRoutines } = useRecoveryRoutines();

  // Force a fresh fetch the moment the user opens the picker. Catches the
  // common case where movements were added in this tab but the cache for
  // this exact filter combination wasn't invalidated.
  useEffect(() => {
    if (!open) return;
    refetchMovements();
    if (includeRoutines) refetchRoutines();
  }, [open, refetchMovements, refetchRoutines, includeRoutines]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    // Movements are filtered server-side via `q`; we don't re-filter here.
    // Routines stay client-side (the routines API doesn't accept a search
    // param) but the same refetch-on-open keeps the list fresh.
    const m = movements ?? [];
    const r = includeRoutines
      ? (routines ?? []).filter((r) => r.name.toLowerCase().includes(q))
      : [];
    return { movements: m, routines: r };
  }, [movements, routines, debouncedSearch, includeRoutines]);

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} variant="outline" size="sm">
        <Plus className="h-3.5 w-3.5 mr-1" />
        {buttonLabel}
      </Button>
    );
  }

  return (
    <Card>
      <CardContent className="py-3 space-y-2">
        <Input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={
            includeRoutines
              ? "Search movements & routines"
              : "Search movements"
          }
        />
        <div className="max-h-72 overflow-y-auto space-y-1">
          {includeRoutines && filtered.routines.length > 0 && (
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mt-2">
              Routines
            </p>
          )}
          {includeRoutines &&
            filtered.routines.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  onAddRoutine?.({ routineId: r.id, routineName: r.name });
                  setOpen(false);
                  setSearch("");
                }}
                className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted/40"
              >
                {r.name}{" "}
                <span className="text-[10px] text-muted-foreground">
                  ({r.movements?.length ?? 0} mov.)
                </span>
              </button>
            ))}
          {filtered.movements.length > 0 && (
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mt-2">
              Movements
            </p>
          )}
          {filtered.movements.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                onAddMovement({
                  movementId: m.id,
                  movementName: m.canonicalName,
                  isPerSide: m.isPerSide,
                  defaultPrescription: m.defaultPrescription as RecoveryPrescription,
                });
                setOpen(false);
                setSearch("");
              }}
              className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted/40 flex items-center gap-2"
            >
              <span className="flex-1 truncate">{m.canonicalName}</span>
              {!m.isValidated && (
                <Badge variant="secondary" className="text-[10px]">
                  <Clock className="h-3 w-3 mr-0.5" />
                  Pending
                </Badge>
              )}
            </button>
          ))}
          {filtered.movements.length === 0 &&
            filtered.routines.length === 0 && (
              <p className="text-xs text-muted-foreground py-2 text-center">
                No matches
              </p>
            )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </CardContent>
    </Card>
  );
}
