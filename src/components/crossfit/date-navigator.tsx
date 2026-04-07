"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
  const dayOfWeek = centerDate.getDay(); // 0=Sun
  const startOfWeek = addDays(centerDate, -dayOfWeek); // Start on Sunday
  return Array.from({ length: 7 }, (_, i) => addDays(startOfWeek, i));
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function DateNavigator({ selectedDate, onDateChange }: DateNavigatorProps) {
  const today = new Date();
  const weekDays = getWeekDays(selectedDate);
  const isToday = isSameDay(selectedDate, today);

  const formattedDate = selectedDate.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="flex flex-col gap-3">
      {/* Date header with arrows */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => onDateChange(addDays(selectedDate, -7))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{formattedDate}</span>
          {!isToday && (
            <button
              onClick={() => onDateChange(today)}
              className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/25"
            >
              Today
            </button>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => onDateChange(addDays(selectedDate, 7))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Day strip */}
      <div className="grid grid-cols-7 gap-1">
        {weekDays.map((day) => {
          const isSelected = isSameDay(day, selectedDate);
          const isDayToday = isSameDay(day, today);

          return (
            <button
              key={day.toISOString()}
              onClick={() => onDateChange(day)}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-xs transition-colors",
                isSelected
                  ? "bg-primary text-primary-foreground"
                  : isDayToday
                    ? "ring-1 ring-primary/40 text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <span className="text-[10px] font-medium uppercase">
                {DAY_LABELS[day.getDay()]}
              </span>
              <span className={cn("text-sm font-semibold", isSelected && "text-primary-foreground")}>
                {day.getDate()}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
