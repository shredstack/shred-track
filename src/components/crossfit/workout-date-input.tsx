"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Local-timezone "today" as YYYY-MM-DD. Avoid `toISOString()` which is UTC
// and can drift the date by one in positive timezones.
export function localTodayString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface WorkoutDateInputProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  label?: string;
}

export function WorkoutDateInput({
  value,
  onChange,
  id = "workout-date",
  label = "Workout Date",
}: WorkoutDateInputProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
