"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Plus } from "lucide-react";
import { useMovements } from "@/hooks/useMovements";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { PickerSheet } from "@/components/shared/picker-sheet";
import { CategoryPills } from "@/components/shared/category-pills";
import type {
  MovementOption,
  MovementCategory,
  CategoryFilter,
} from "@/types/crossfit";
import { CATEGORY_FILTER_OPTIONS, MOVEMENT_CATEGORY_COLORS } from "@/types/crossfit";

// ============================================
// Component
// ============================================

// Stable empty reference for the pre-load window, so `movements` keeps a
// constant identity and downstream useMemos don't rerun every render.
const NO_MOVEMENTS: MovementOption[] = [];

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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const debouncedQuery = useDebouncedValue(query.trim(), 250);
  // Server-side search guarantees that movements added since the picker
  // mounted are still findable — pure client filtering of a stale cache
  // returns "no matches" for them.
  const { data: fetched, refetch: refetchMovements } = useMovements({
    q: debouncedQuery || undefined,
  });
  // No placeholder list: the picker only ever offers real, saveable
  // movements. A fake-id stand-in could be selected and would fail the
  // workout insert (movement_id must be a real UUID). `useMovements` uses
  // keepPreviousData, so after the first load this only empties on a cold
  // open — handled by the "Loading movements…" state below.
  const movements = movementsOverride ?? fetched ?? NO_MOVEMENTS;
  const movementsLoading = !movementsOverride && fetched === undefined;

  // Force a fresh fetch the moment the user opens the picker. Catches the
  // case where movements were created elsewhere and this cache key never
  // received an invalidation.
  useEffect(() => {
    if (!open || movementsOverride) return;
    refetchMovements();
  }, [open, movementsOverride, refetchMovements]);

  // Pure-search picker: the list stays empty until the user types. Browsing
  // the full library is slower than searching when a gym admin needs a
  // specific movement, so the picker opens straight to a search prompt.
  const hasQuery = query.trim().length > 0;

  const filtered = useMemo(() => {
    // Search is applied server-side via `q`; category stays client-side so
    // toggling pills is instant and we don't burn a request per pill.
    return category === "all"
      ? movements
      : movements.filter((m) => m.category === category);
  }, [movements, category]);

  const displayItems = hasQuery ? filtered : NO_MOVEMENTS;

  const showAddNew = !!onAddNew && hasQuery;
  const totalItems = displayItems.length + (showAddNew ? 1 : 0);

  const closeAndReset = useCallback(() => {
    setOpen(false);
    setQuery("");
    setCategory("all");
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

  // The search field is focused on open via PickerSheet's `initialFocus`
  // prop (see the <PickerSheet> below) — Base UI focuses it as part of the
  // dialog's own open sequence, so the user can type immediately.

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
        if (highlightIndex < displayItems.length) {
          handleSelect(displayItems[highlightIndex]);
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
        initialFocus={inputRef}
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

        <CategoryPills
          value={category}
          onChange={(next) => {
            setCategory(next);
            setHighlightIndex(0);
          }}
          options={CATEGORY_FILTER_OPTIONS}
          className="px-3 pb-2"
        />

        <div
          ref={listRef}
          className="flex-1 overflow-y-auto px-2 pb-4"
          role="listbox"
        >
          {!hasQuery && (
            <div className="px-3 py-10 text-center text-sm text-muted-foreground">
              Start typing to find a movement
            </div>
          )}

          {hasQuery && displayItems.length === 0 && !showAddNew && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              {movementsLoading ? "Loading movements…" : "No movements found"}
            </div>
          )}

          {displayItems.map((movement, idx) => (
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
              aria-selected={highlightIndex === displayItems.length}
              className={`mt-1 flex w-full items-center gap-2 rounded-md border-t border-border px-3 py-2.5 text-left text-sm transition-colors ${
                highlightIndex === displayItems.length
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50"
              }`}
              onMouseEnter={() => setHighlightIndex(displayItems.length)}
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
