"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { STIMULUS_CLASSES, type StimulusClass } from "@/db/schema";

interface ProfileRow {
  stimulusClass: StimulusClass;
  movementCategory: string;
  pct1rmLow: number;
  pct1rmHigh: number;
  notes: string | null;
  updatedAt: string;
}

interface ProfilesResponse {
  profiles: ProfileRow[];
  stimulusClasses: readonly StimulusClass[];
}

const STIMULUS_LABELS: Record<StimulusClass, string> = {
  strength_heavy: "Strength — heavy",
  strength_moderate: "Strength — moderate",
  short_intense: "Short / intense metcon",
  moderate_metcon: "Moderate metcon",
  long_metcon: "Long metcon",
  oly_metcon: "Olympic-flavored metcon",
};

// Categories shown in the editor. Anything new the seed/migration covers can
// just be added here.
const CATEGORIES = ["barbell", "olympic", "dumbbell", "kettlebell"] as const;

function useStimulusProfiles() {
  return useQuery<ProfilesResponse>({
    queryKey: ["admin", "stimulus-profiles"],
    queryFn: async () => {
      const res = await fetch("/api/admin/stimulus-profiles");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });
}

function useUpsertProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      stimulusClass: StimulusClass;
      movementCategory: string;
      pct1rmLow: number;
      pct1rmHigh: number;
      notes?: string | null;
    }) => {
      const res = await fetch("/api/admin/stimulus-profiles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "stimulus-profiles"] });
    },
  });
}

export function AdminStimulusProfiles() {
  const { data, isLoading } = useStimulusProfiles();

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }

  const byKey = new Map<string, ProfileRow>();
  for (const p of data?.profiles ?? []) {
    byKey.set(`${p.stimulusClass}:${p.movementCategory}`, p);
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        %1RM bands per (stimulus class, movement category). The suggested-
        weight engine multiplies an athlete&apos;s 1RM by the low / high band
        to produce a working-weight range. Tunable; saves are immediate.
      </p>
      {STIMULUS_CLASSES.map((cls) => (
        <Card key={cls}>
          <CardHeader>
            <CardTitle className="text-sm">{STIMULUS_LABELS[cls]}</CardTitle>
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {cls}
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {CATEGORIES.map((cat) => (
              <ProfileRowEditor
                key={cat}
                stimulusClass={cls}
                movementCategory={cat}
                existing={byKey.get(`${cls}:${cat}`) ?? null}
              />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ProfileRowEditor({
  stimulusClass,
  movementCategory,
  existing,
}: {
  stimulusClass: StimulusClass;
  movementCategory: string;
  existing: ProfileRow | null;
}) {
  const [low, setLow] = useState<string>(
    existing ? toPct(existing.pct1rmLow) : ""
  );
  const [high, setHigh] = useState<string>(
    existing ? toPct(existing.pct1rmHigh) : ""
  );
  const [notes, setNotes] = useState<string>(existing?.notes ?? "");
  const upsert = useUpsertProfile();

  const dirty = useMemo(() => {
    if (!existing) return Boolean(low || high || notes);
    return (
      toPct(existing.pct1rmLow) !== low ||
      toPct(existing.pct1rmHigh) !== high ||
      (existing.notes ?? "") !== notes
    );
  }, [existing, low, high, notes]);

  const onSave = async () => {
    const pctLow = Number(low) / 100;
    const pctHigh = Number(high) / 100;
    if (!Number.isFinite(pctLow) || !Number.isFinite(pctHigh)) {
      toast.error("Both percentages required");
      return;
    }
    try {
      await upsert.mutateAsync({
        stimulusClass,
        movementCategory,
        pct1rmLow: pctLow,
        pct1rmHigh: pctHigh,
        notes: notes || null,
      });
      toast.success("Saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-border/40 bg-muted/10 p-3">
      <div className="flex items-end gap-2 flex-wrap">
        <div className="min-w-24 flex-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {movementCategory}
          </Label>
        </div>
        <div className="w-24">
          <Label className="text-[10px] text-muted-foreground">low %</Label>
          <Input
            inputMode="decimal"
            value={low}
            onChange={(e) => setLow(e.target.value)}
            placeholder="—"
          />
        </div>
        <div className="w-24">
          <Label className="text-[10px] text-muted-foreground">high %</Label>
          <Input
            inputMode="decimal"
            value={high}
            onChange={(e) => setHigh(e.target.value)}
            placeholder="—"
          />
        </div>
        <Button
          size="sm"
          onClick={onSave}
          disabled={!dirty || upsert.isPending}
        >
          {upsert.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
          Save
        </Button>
      </div>
      <Input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Optional notes (source / tuning context)"
        className="text-xs"
      />
    </div>
  );
}

function toPct(pct: number): string {
  // 0.55 → "55"
  return (Math.round(pct * 1000) / 10).toString();
}
