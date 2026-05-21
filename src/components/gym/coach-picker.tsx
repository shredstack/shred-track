"use client";

// Shared coach selector for gym classes + schedules. Use this everywhere a
// coach is assigned so the experience stays consistent and the @base-ui
// SelectValue quirk (renders the raw value unless given explicit children)
// is handled in exactly one place.

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CoachOption } from "@/hooks/useClasses";

// Sentinel for the "no coach" choice — base-ui Select has no native empty value.
const NONE = "__none__";

interface CoachPickerProps {
  coaches: CoachOption[];
  value: string | null;
  onChange: (coachId: string | null) => void;
  /**
   * Label to show when `value` is set but missing from `coaches` — e.g. a
   * coach who has since left the gym. Lets callers pass a name joined
   * server-side so the trigger never falls back to "Unknown coach".
   */
  fallbackLabel?: string;
  disabled?: boolean;
  size?: "sm" | "default";
  className?: string;
}

export function CoachPicker({
  coaches,
  value,
  onChange,
  fallbackLabel,
  disabled,
  size = "default",
  className,
}: CoachPickerProps) {
  const label = value
    ? coaches.find((c) => c.id === value)?.name ??
      fallbackLabel ??
      "Unknown coach"
    : "No coach";

  return (
    <Select
      value={value ?? NONE}
      onValueChange={(v) => onChange(v === NONE || v === null ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger size={size} className={className}>
        <SelectValue placeholder="No coach">{label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No coach</SelectItem>
        {coaches.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
