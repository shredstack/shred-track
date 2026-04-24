"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Plus } from "lucide-react";
import { useMovements } from "@/hooks/useMovements";
import type { MovementOption, MovementCategory } from "@/types/crossfit";
import { MOVEMENT_CATEGORY_COLORS } from "@/types/crossfit";

// ============================================
// Fallback library — used only when the live fetch hasn't returned yet
// or when a caller explicitly opts out (e.g. tests, storybook).
// ============================================

const FALLBACK_MOVEMENTS: MovementOption[] = [
  { id: "m-1", canonicalName: "Thruster", category: "barbell", isWeighted: true, is1rmApplicable: false },
  { id: "m-2", canonicalName: "Clean", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { id: "m-3", canonicalName: "Power Clean", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { id: "m-4", canonicalName: "Squat Clean", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { id: "m-5", canonicalName: "Hang Power Clean", category: "barbell", isWeighted: true, is1rmApplicable: false },
  { id: "m-6", canonicalName: "Hang Squat Clean", category: "barbell", isWeighted: true, is1rmApplicable: false },
  { id: "m-7", canonicalName: "Snatch", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { id: "m-8", canonicalName: "Power Snatch", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { id: "m-9", canonicalName: "Squat Snatch", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { id: "m-10", canonicalName: "Deadlift", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { id: "m-11", canonicalName: "Front Squat", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { id: "m-12", canonicalName: "Back Squat", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { id: "m-13", canonicalName: "Overhead Squat", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { id: "m-14", canonicalName: "Push Press", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { id: "m-15", canonicalName: "Push Jerk", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { id: "m-16", canonicalName: "Split Jerk", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { id: "m-17", canonicalName: "Strict Press", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { id: "m-18", canonicalName: "Bench Press", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { id: "m-19", canonicalName: "Sumo Deadlift High Pull", category: "barbell", isWeighted: true, is1rmApplicable: false },
  { id: "m-20", canonicalName: "Clean and Jerk", category: "barbell", isWeighted: true, is1rmApplicable: true },
  { id: "m-21", canonicalName: "Cluster", category: "barbell", isWeighted: true, is1rmApplicable: false },
  { id: "m-22", canonicalName: "Shoulder-to-Overhead", category: "barbell", isWeighted: true, is1rmApplicable: false },
  { id: "m-23", canonicalName: "Ground-to-Overhead", category: "barbell", isWeighted: true, is1rmApplicable: false },
  { id: "m-30", canonicalName: "Dumbbell Snatch", category: "dumbbell", isWeighted: true, is1rmApplicable: false },
  { id: "m-31", canonicalName: "Dumbbell Clean", category: "dumbbell", isWeighted: true, is1rmApplicable: false },
  { id: "m-32", canonicalName: "Devil Press", category: "dumbbell", isWeighted: true, is1rmApplicable: false },
  { id: "m-33", canonicalName: "Dumbbell Thruster", category: "dumbbell", isWeighted: true, is1rmApplicable: false },
  { id: "m-40", canonicalName: "Kettlebell Swing", category: "kettlebell", isWeighted: true, is1rmApplicable: false },
  { id: "m-41", canonicalName: "Turkish Get-Up", category: "kettlebell", isWeighted: true, is1rmApplicable: false },
  { id: "m-42", canonicalName: "Goblet Squat", category: "kettlebell", isWeighted: true, is1rmApplicable: false },
  { id: "m-50", canonicalName: "Pull-Up", category: "gymnastics", isWeighted: false, is1rmApplicable: false },
  { id: "m-51", canonicalName: "Chest-to-Bar Pull-Up", category: "gymnastics", isWeighted: false, is1rmApplicable: false },
  { id: "m-52", canonicalName: "Bar Muscle-Up", category: "gymnastics", isWeighted: false, is1rmApplicable: false },
  { id: "m-53", canonicalName: "Ring Muscle-Up", category: "gymnastics", isWeighted: false, is1rmApplicable: false },
  { id: "m-54", canonicalName: "Toes-to-Bar", category: "gymnastics", isWeighted: false, is1rmApplicable: false },
  { id: "m-55", canonicalName: "Knees-to-Elbows", category: "gymnastics", isWeighted: false, is1rmApplicable: false },
  { id: "m-56", canonicalName: "Handstand Push-Up", category: "gymnastics", isWeighted: false, is1rmApplicable: false },
  { id: "m-57", canonicalName: "Handstand Walk", category: "gymnastics", isWeighted: false, is1rmApplicable: false },
  { id: "m-58", canonicalName: "Ring Dip", category: "gymnastics", isWeighted: false, is1rmApplicable: false },
  { id: "m-59", canonicalName: "Rope Climb", category: "gymnastics", isWeighted: false, is1rmApplicable: false },
  { id: "m-60", canonicalName: "Legless Rope Climb", category: "gymnastics", isWeighted: false, is1rmApplicable: false },
  { id: "m-61", canonicalName: "Wall Walk", category: "gymnastics", isWeighted: false, is1rmApplicable: false },
  { id: "m-70", canonicalName: "Air Squat", category: "bodyweight", isWeighted: false, is1rmApplicable: false },
  { id: "m-71", canonicalName: "Burpee", category: "bodyweight", isWeighted: false, is1rmApplicable: false },
  { id: "m-72", canonicalName: "Push-Up", category: "bodyweight", isWeighted: false, is1rmApplicable: false },
  { id: "m-73", canonicalName: "Sit-Up", category: "bodyweight", isWeighted: false, is1rmApplicable: false },
  { id: "m-74", canonicalName: "Lunge", category: "bodyweight", isWeighted: false, is1rmApplicable: false },
  { id: "m-75", canonicalName: "Pistol Squat", category: "bodyweight", isWeighted: false, is1rmApplicable: false },
  { id: "m-76", canonicalName: "Box Jump", category: "bodyweight", isWeighted: false, is1rmApplicable: false },
  { id: "m-77", canonicalName: "Box Jump Over", category: "bodyweight", isWeighted: false, is1rmApplicable: false },
  { id: "m-78", canonicalName: "Bar-Facing Burpee", category: "bodyweight", isWeighted: false, is1rmApplicable: false },
  { id: "m-79", canonicalName: "Burpee Box Jump Over", category: "bodyweight", isWeighted: false, is1rmApplicable: false },
  { id: "m-80", canonicalName: "Wall Ball Shot", category: "bodyweight", isWeighted: true, is1rmApplicable: false },
  { id: "m-81", canonicalName: "GHD Sit-Up", category: "bodyweight", isWeighted: false, is1rmApplicable: false },
  { id: "m-90", canonicalName: "Row", category: "monostructural", isWeighted: false, is1rmApplicable: false },
  { id: "m-91", canonicalName: "Assault Bike", category: "monostructural", isWeighted: false, is1rmApplicable: false },
  { id: "m-92", canonicalName: "Echo Bike", category: "monostructural", isWeighted: false, is1rmApplicable: false },
  { id: "m-93", canonicalName: "Run", category: "monostructural", isWeighted: false, is1rmApplicable: false },
  { id: "m-94", canonicalName: "Ski Erg", category: "monostructural", isWeighted: false, is1rmApplicable: false },
  { id: "m-95", canonicalName: "Double-Under", category: "monostructural", isWeighted: false, is1rmApplicable: false },
  { id: "m-96", canonicalName: "Single-Under", category: "monostructural", isWeighted: false, is1rmApplicable: false },
];

// ============================================
// Component
// ============================================

interface MovementSearchProps {
  onSelect: (movement: MovementOption) => void;
  onAddNew?: (name: string) => void;
  placeholder?: string;
  /** Override the live fetch — used by tests. Production paths shouldn't pass this. */
  movements?: MovementOption[];
}

export function MovementSearch({
  onSelect,
  onAddNew,
  placeholder = "Search movements...",
  movements: movementsOverride,
}: MovementSearchProps) {
  const { data: fetched } = useMovements();
  const movements = movementsOverride ?? fetched ?? FALLBACK_MOVEMENTS;
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query.trim()
    ? movements.filter((m) =>
        m.canonicalName.toLowerCase().includes(query.toLowerCase())
      )
    : movements;

  const handleSelect = useCallback(
    (movement: MovementOption) => {
      onSelect(movement);
      setQuery("");
      setIsOpen(false);
    },
    [onSelect]
  );

  const handleAddNew = useCallback(() => {
    if (onAddNew && query.trim()) {
      onAddNew(query.trim());
      setQuery("");
      setIsOpen(false);
    }
  }, [onAddNew, query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;

    const totalItems = filtered.length + (onAddNew && query.trim() ? 1 : 0);

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightIndex((i) => (i + 1) % totalItems);
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightIndex((i) => (i - 1 + totalItems) % totalItems);
        break;
      case "Enter":
        e.preventDefault();
        if (highlightIndex < filtered.length) {
          handleSelect(filtered[highlightIndex]);
        } else {
          handleAddNew();
        }
        break;
      case "Escape":
        setIsOpen(false);
        break;
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlightIndex(0);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="pl-8"
        />
      </div>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
          {filtered.length === 0 && !query.trim() && (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              No movements found
            </div>
          )}

          {filtered.map((movement, idx) => (
            <button
              key={movement.id}
              type="button"
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                idx === highlightIndex
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50"
              }`}
              onMouseEnter={() => setHighlightIndex(idx)}
              onClick={() => handleSelect(movement)}
            >
              <span className="flex-1">{movement.canonicalName}</span>
              <Badge
                variant="secondary"
                className={`text-[10px] ${
                  MOVEMENT_CATEGORY_COLORS[
                    movement.category as MovementCategory
                  ] || ""
                }`}
              >
                {movement.category}
              </Badge>
            </button>
          ))}

          {onAddNew && query.trim() && (
            <button
              type="button"
              className={`flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm transition-colors ${
                highlightIndex === filtered.length
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50"
              }`}
              onMouseEnter={() => setHighlightIndex(filtered.length)}
              onClick={handleAddNew}
            >
              <Plus className="size-4 text-muted-foreground" />
              <span>
                Add &quot;{query.trim()}&quot; as new movement
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export { FALLBACK_MOVEMENTS };
