"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Plus } from "lucide-react";
import { useMovements } from "@/hooks/useMovements";
import { PickerSheet } from "@/components/shared/picker-sheet";
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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () =>
      query.trim()
        ? movements.filter((m) =>
            m.canonicalName.toLowerCase().includes(query.toLowerCase()),
          )
        : movements,
    [movements, query],
  );

  const showAddNew = !!onAddNew && query.trim().length > 0;
  const totalItems = filtered.length + (showAddNew ? 1 : 0);

  const closeAndReset = useCallback(() => {
    setOpen(false);
    setQuery("");
    setHighlightIndex(0);
  }, []);

  const handleSelect = useCallback(
    (movement: MovementOption) => {
      onSelect(movement);
      closeAndReset();
    },
    [onSelect, closeAndReset],
  );

  const handleAddNew = useCallback(() => {
    const trimmed = query.trim();
    if (onAddNew && trimmed) {
      onAddNew(trimmed);
      closeAndReset();
    }
  }, [onAddNew, query, closeAndReset]);

  // Focus the search field once the sheet has opened. The next-frame defer
  // gives the entrance animation time to settle so iOS reliably shows the
  // keyboard.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Keep the highlighted item visible as the user arrows through the list.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const el = list.children[highlightIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex, open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (totalItems === 0) return;
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
        } else if (showAddNew) {
          handleAddNew();
        }
        break;
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{placeholder}</span>
      </button>

      <PickerSheet
        open={open}
        onOpenChange={(next) => {
          if (!next) closeAndReset();
          else setOpen(true);
        }}
        title="Add Movement"
      >
        <div className="px-4 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlightIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="pl-8"
              enterKeyHint="search"
              autoComplete="off"
            />
          </div>
        </div>

        <div
          ref={listRef}
          className="flex-1 overflow-y-auto px-2 pb-4"
          role="listbox"
        >
          {filtered.length === 0 && !showAddNew && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No movements found
            </div>
          )}

          {filtered.map((movement, idx) => (
            <button
              key={movement.id}
              type="button"
              role="option"
              aria-selected={idx === highlightIndex}
              className={`flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm transition-colors ${
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

          {showAddNew && (
            <button
              type="button"
              role="option"
              aria-selected={highlightIndex === filtered.length}
              className={`mt-1 flex w-full items-center gap-2 rounded-md border-t border-border px-3 py-2.5 text-left text-sm transition-colors ${
                highlightIndex === filtered.length
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50"
              }`}
              onMouseEnter={() => setHighlightIndex(filtered.length)}
              onClick={handleAddNew}
            >
              <Plus className="size-4 text-muted-foreground" />
              <span>Add &quot;{query.trim()}&quot; as new movement</span>
            </button>
          )}
        </div>
      </PickerSheet>
    </>
  );
}

export { FALLBACK_MOVEMENTS };
