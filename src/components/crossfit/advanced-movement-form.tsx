"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MOVEMENT_CATEGORIES,
  MOVEMENT_METRIC_TYPES,
  RX_FIELDS,
  type MovementCategory,
  type MovementMetricType,
  type RxField,
  type RxDefaults,
} from "@/types/crossfit";
import type { CreateMovementInput } from "@/hooks/useMovements";

// ============================================
// AdvancedMovementForm
// ============================================
//
// The richer custom-movement creation flow gated behind the "Advanced"
// toggle in MovementListBuilder. The fast path (type a name + enter) still
// exists alongside this — slowing the fast path down was non-negotiable.
//
// What this form lets the user declare:
//   - Canonical name + category (the existing fields)
//   - "How is this movement scored?" — multi-select metric types →
//     supported_metric_types
//   - "What Rx fields apply?" — multi-select rx fields → rx_fields
//   - Per-field default values (gendered where it matters) → rx_defaults
//
// On submit, the parent (MovementListBuilder for the workout-builder
// flow, or the admin form for direct edits) calls the create mutation
// and adds the result to the workout in one shot.

interface AdvancedMovementFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: CreateMovementInput) => Promise<void> | void;
  // For the admin/edit path the same form re-uses prefilled state.
  initial?: Partial<CreateMovementInput>;
  submitLabel?: string;
  title?: string;
  busy?: boolean;
}

interface FormState {
  canonicalName: string;
  category: MovementCategory;
  isWeighted: boolean;
  is1rmApplicable: boolean;
  metricType: MovementMetricType;
  supportedMetricTypes: MovementMetricType[];
  rxFields: RxField[];
  rxDefaults: RxDefaults;
}

function emptyState(initial?: Partial<CreateMovementInput>): FormState {
  return {
    canonicalName: initial?.canonicalName ?? "",
    category: initial?.category ?? "other",
    isWeighted: initial?.isWeighted ?? false,
    is1rmApplicable: false,
    metricType: initial?.metricType ?? "reps",
    supportedMetricTypes:
      initial?.supportedMetricTypes ??
      (initial?.metricType ? [initial.metricType] : ["reps"]),
    rxFields: initial?.rxFields ?? [],
    rxDefaults: initial?.rxDefaults ?? {},
  };
}

// Metadata for each Rx field — drives the "default value" inputs section.
// Each row produces 1-2 numeric / text inputs depending on whether the
// field has a gendered split.
const RX_FIELD_META: Record<
  RxField,
  {
    label: string;
    keys: { key: keyof RxDefaults; label: string; placeholder?: string }[];
  }
> = {
  weight: {
    label: "Weight (lb)",
    keys: [
      { key: "weight_male", label: "M (lb)", placeholder: "e.g. 95" },
      { key: "weight_female", label: "F (lb)", placeholder: "e.g. 65" },
    ],
  },
  weight_bw: {
    label: "% bodyweight",
    keys: [
      { key: "weight_bw_male", label: "M (×BW)", placeholder: "e.g. 1.5" },
      { key: "weight_bw_female", label: "F (×BW)", placeholder: "e.g. 1.25" },
    ],
  },
  height: {
    label: "Height (in)",
    keys: [
      { key: "height_inches_male", label: "M (in)", placeholder: "e.g. 24" },
      { key: "height_inches_female", label: "F (in)", placeholder: "e.g. 20" },
    ],
  },
  calories: {
    label: "Calories",
    keys: [
      { key: "calories_male", label: "M (cal)", placeholder: "e.g. 21" },
      { key: "calories_female", label: "F (cal)", placeholder: "e.g. 15" },
    ],
  },
  distance: {
    label: "Distance (m)",
    keys: [
      { key: "distance_male", label: "M (m)", placeholder: "e.g. 400" },
      { key: "distance_female", label: "F (m)", placeholder: "e.g. 320" },
    ],
  },
  duration: {
    label: "Duration (sec)",
    keys: [
      {
        key: "duration_seconds_male",
        label: "M (sec)",
        placeholder: "e.g. 60",
      },
      {
        key: "duration_seconds_female",
        label: "F (sec)",
        placeholder: "e.g. 60",
      },
    ],
  },
  tempo: {
    label: "Tempo",
    keys: [{ key: "tempo", label: "Tempo", placeholder: "e.g. 30X1" }],
  },
};

export function AdvancedMovementForm({
  open,
  onOpenChange,
  onSubmit,
  initial,
  submitLabel = "Create",
  title = "Add Custom Movement",
  busy = false,
}: AdvancedMovementFormProps) {
  const [form, setForm] = useState<FormState>(() => emptyState(initial));
  const [error, setError] = useState<string | null>(null);

  // Reset state when the dialog re-opens with different `initial` data.
  useEffect(() => {
    if (open) {
      setForm(emptyState(initial));
      setError(null);
    }
  }, [open, initial]);

  const toggleSupported = useCallback(
    (mt: MovementMetricType) =>
      setForm((prev) => {
        const has = prev.supportedMetricTypes.includes(mt);
        const next = has
          ? prev.supportedMetricTypes.filter((m) => m !== mt)
          : [...prev.supportedMetricTypes, mt];
        // The metric_type column is a single value; keep it in sync
        // with the first chosen metric so the row's legacy fallback is
        // still meaningful.
        return {
          ...prev,
          supportedMetricTypes: next.length > 0 ? next : ["reps"],
          metricType: next[0] ?? "reps",
        };
      }),
    []
  );

  const toggleRxField = useCallback(
    (f: RxField) =>
      setForm((prev) => {
        const has = prev.rxFields.includes(f);
        const next = has
          ? prev.rxFields.filter((x) => x !== f)
          : [...prev.rxFields, f];
        // Drop defaults for the field if we're removing it.
        const defaults = { ...prev.rxDefaults };
        if (has) {
          for (const k of RX_FIELD_META[f].keys) {
            delete defaults[k.key];
          }
        }
        return { ...prev, rxFields: next, rxDefaults: defaults };
      }),
    []
  );

  const setDefault = useCallback(
    (key: keyof RxDefaults, value: string) =>
      setForm((prev) => ({
        ...prev,
        rxDefaults: { ...prev.rxDefaults, [key]: value },
      })),
    []
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const name = form.canonicalName.trim();
      if (!name) {
        setError("Name is required");
        return;
      }
      // Coerce empty-string defaults to undefined so we don't send "" to
      // the JSONB column.
      const cleanedDefaults: RxDefaults = {};
      for (const [k, v] of Object.entries(form.rxDefaults)) {
        if (v == null || v === "") continue;
        // Numeric fields → coerce. Tempo stays as a string.
        if (k === "tempo") {
          cleanedDefaults[k as "tempo"] = String(v);
        } else {
          const n = typeof v === "number" ? v : parseFloat(String(v));
          if (Number.isFinite(n)) {
            (cleanedDefaults as Record<string, number>)[k] = n;
          }
        }
      }

      const isWeighted =
        form.isWeighted ||
        form.supportedMetricTypes.includes("weight") ||
        form.rxFields.includes("weight");

      try {
        await onSubmit({
          canonicalName: name,
          category: form.category,
          isWeighted,
          metricType: form.metricType,
          supportedMetricTypes: form.supportedMetricTypes,
          rxFields: form.rxFields,
          rxDefaults: cleanedDefaults,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save");
      }
    },
    [form, onSubmit]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Declare which scoring metrics and Rx inputs this movement should
            surface. The builder will render those inputs automatically.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="amf-name">Name</Label>
            <Input
              id="amf-name"
              value={form.canonicalName}
              onChange={(e) =>
                setForm((p) => ({ ...p, canonicalName: e.target.value }))
              }
              placeholder="e.g. Sandbag Clean"
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Category</Label>
            <Select
              value={form.category}
              onValueChange={(v) =>
                setForm((p) => ({ ...p, category: v as MovementCategory }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MOVEMENT_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* How scored? — multi-select chips */}
          <div className="space-y-2">
            <Label>How is this movement scored?</Label>
            <div className="flex flex-wrap gap-1">
              {MOVEMENT_METRIC_TYPES.map((mt) => {
                const selected = form.supportedMetricTypes.includes(mt);
                return (
                  <button
                    key={mt}
                    type="button"
                    onClick={() => toggleSupported(mt)}
                    className={`rounded-md px-2 py-1 text-xs font-medium capitalize ${
                      selected
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/50 text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {mt}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Pick one or more. The builder lets the user choose which metric
              applies for a given workout.
            </p>
          </div>

          {/* What Rx fields? — multi-select chips */}
          <div className="space-y-2">
            <Label>What Rx fields apply?</Label>
            <div className="flex flex-wrap gap-1">
              {RX_FIELDS.map((f) => {
                const selected = form.rxFields.includes(f);
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => toggleRxField(f)}
                    className={`rounded-md px-2 py-1 text-xs font-medium ${
                      selected
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/50 text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {f.replace("_", " ")}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Each chosen field becomes an input on the workout builder.
              Leave empty to fall back to the legacy hardcoded behavior.
            </p>
          </div>

          {/* Per-field defaults — only renders sections for selected fields */}
          {form.rxFields.length > 0 && (
            <div className="space-y-2">
              <Label>Default values (optional)</Label>
              <div className="space-y-3 rounded-lg border border-border/50 bg-muted/20 p-3">
                {form.rxFields.map((f) => {
                  const meta = RX_FIELD_META[f];
                  return (
                    <div key={f} className="space-y-1.5">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {meta.label}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {meta.keys.map((k) => (
                          <div key={k.key} className="space-y-0.5">
                            <Label className="text-[11px] text-muted-foreground/80">
                              {k.label}
                            </Label>
                            <Input
                              value={String(form.rxDefaults[k.key] ?? "")}
                              onChange={(e) =>
                                setDefault(k.key, e.target.value)
                              }
                              placeholder={k.placeholder}
                              className="h-7 text-xs"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
