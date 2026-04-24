"use client";

import { useRef } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface DateNavigatorProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function getWeekDays(centerDate: Date): Date[] {
  const dayOfWeek = centerDate.getDay();
  const startOfWeek = addDays(centerDate, -dayOfWeek);
  return Array.from({ length: 7 }, (_, i) => addDays(startOfWeek, i));
}

// Local (not UTC) YYYY-MM-DD — matches what <input type="date"> returns and
// avoids the off-by-one that bites toISOString() in negative timezones.
function toLocalDateString(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

export function DateNavigator({ selectedDate, onDateChange }: DateNavigatorProps) {
  const today = new Date();
  const weekDays = getWeekDays(selectedDate);
  const isToday = isSameDay(selectedDate, today);
  const dateInputRef = useRef<HTMLInputElement>(null);

  const monthYear = selectedDate.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const openPicker = () => {
    const input = dateInputRef.current;
    if (!input) return;
    // showPicker() is the modern call; fall back to focusing the input so
    // browsers without it (older Safari) still surface the native calendar.
    if (typeof input.showPicker === "function") {
      try {
        input.showPicker();
        return;
      } catch {
        // Some browsers throw if called without a user gesture — fall through.
      }
    }
    input.focus();
    input.click();
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Month header with arrows */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => onDateChange(addDays(selectedDate, -7))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={openPicker}
            className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-sm font-semibold transition-colors hover:bg-white/[0.04]"
            aria-label="Jump to date"
          >
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            {monthYear}
          </button>
          {!isToday && (
            <button
              onClick={() => onDateChange(today)}
              className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-bold text-primary transition-all hover:bg-primary/25 glow-primary-sm"
            >
              Today
            </button>
          )}
          <input
            ref={dateInputRef}
            type="date"
            value={toLocalDateString(selectedDate)}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              const [y, m, d] = v.split("-").map(Number);
              onDateChange(new Date(y, m - 1, d));
            }}
            className="pointer-events-none absolute h-0 w-0 opacity-0"
            tabIndex={-1}
            aria-hidden="true"
          />
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => onDateChange(addDays(selectedDate, 7))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Day strip */}
      <div className="grid grid-cols-7 gap-1.5">
        {weekDays.map((day) => {
          const isSelected = isSameDay(day, selectedDate);
          const isDayToday = isSameDay(day, today);

          return (
            <button
              key={day.toISOString()}
              onClick={() => onDateChange(day)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-xl py-2 text-xs transition-all duration-200",
                isSelected
                  ? "bg-primary text-primary-foreground glow-primary-sm"
                  : isDayToday
                    ? "bg-primary/10 text-primary ring-1 ring-primary/30"
                    : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
              )}
            >
              <span className="text-[10px] font-medium uppercase opacity-70">
                {DAY_LABELS[day.getDay()]}
              </span>
              <span className={cn("text-base font-bold leading-none", !isSelected && !isDayToday && "text-foreground")}>
                {day.getDate()}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
