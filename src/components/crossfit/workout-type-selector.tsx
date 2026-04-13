"use client";

import {
  Clock,
  Infinity,
  Timer,
  Dumbbell,
  Hash,
  Flame,
  BarChart3,
  Zap,
  MoreHorizontal,
} from "lucide-react";
import type { WorkoutType } from "@/types/crossfit";

const WORKOUT_TYPE_OPTIONS: {
  value: WorkoutType;
  label: string;
  icon: React.ElementType;
  color: string;
}[] = [
  { value: "for_time", label: "For Time", icon: Clock, color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  { value: "amrap", label: "AMRAP", icon: Infinity, color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  { value: "emom", label: "EMOM", icon: Timer, color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  { value: "for_load", label: "For Load", icon: Dumbbell, color: "bg-red-500/20 text-red-400 border-red-500/30" },
  { value: "for_reps", label: "For Reps", icon: Hash, color: "bg-green-500/20 text-green-400 border-green-500/30" },
  { value: "for_calories", label: "For Calories", icon: Flame, color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  { value: "tabata", label: "Tabata", icon: BarChart3, color: "bg-pink-500/20 text-pink-400 border-pink-500/30" },
  { value: "max_effort", label: "Max Effort", icon: Zap, color: "bg-rose-500/20 text-rose-400 border-rose-500/30" },
  { value: "other", label: "Other", icon: MoreHorizontal, color: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30" },
];

interface WorkoutTypeSelectorProps {
  value?: WorkoutType;
  onSelect: (type: WorkoutType) => void;
}

export function WorkoutTypeSelector({ value, onSelect }: WorkoutTypeSelectorProps) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {WORKOUT_TYPE_OPTIONS.map(({ value: type, label, icon: Icon, color }) => {
        const isSelected = value === type;
        return (
          <button
            key={type}
            type="button"
            onClick={() => onSelect(type)}
            className={`flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-all ${
              isSelected
                ? `${color} border-current ring-1 ring-current/30`
                : "border-border/50 bg-muted/20 text-muted-foreground hover:bg-muted/40"
            }`}
          >
            <Icon className="size-5" />
            <span className="text-xs font-medium">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
