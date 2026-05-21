"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Plus } from "lucide-react";
import { useMovements, useRecentMovements } from "@/hooks/useMovements";
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
  const { data: recentIds, refetch: refetchRecent } = useRecentMovements();
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
    refetchRecent();
  }, [open, movementsOverride, refetchMovements, refetchRecent]);

  const filtered = useMemo(() => {
    // Search is applied server-side via `q`; category stays client-side so
    // toggling pills is instant and we don't burn a request per pill.
    return category === "all"
      ? movements
      : movements.filter((m) => m.category === category);
  }, [movements, category]);

  // Show the "Recent" group only when the user hasn't narrowed the list — once
  // they pick a category or start typing, grouping just gets in the way.
  const showGroupedRecent =
    category === "all" &&
    query.trim().length === 0 &&
    !!recentIds &&
    recentIds.length > 0;

  // When grouping is on, hoist recent movements to the top of the display list.
  // The id-preserving order from the API drives the within-group order.
  const { displayItems, recentCount } = useMemo(() => {
    if (!showGroupedRecent || !recentIds) {
      return { displayItems: filtered, recentCount: 0 };
    }
    const byId = new Map(filtered.map((m) => [m.id, m]));
    const recent: MovementOption[] = [];
    const seen = new Set<string>();
    for (const id of recentIds) {
      const m = byId.get(id);
      if (m && !seen.has(id)) {
        recent.push(m);
        seen.add(id);
      }
    }
    const rest = filtered.filter((m) => !seen.has(m.id));
    return { displayItems: [...recent, ...rest], recentCount: recent.length };
  }, [filtered, recentIds, showGroupedRecent]);

  const showAddNew = !!onAddNew && query.trim().length > 0;
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
          {displayItems.length === 0 && !showAddNew && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              {movementsLoading ? "Loading movements…" : "No movements found"}
            </div>
          )}

          {displayItems.map((movement, idx) => {
            const isFirstRecent = showGroupedRecent && idx === 0;
            const isFirstAfterRecent =
              showGroupedRecent && recentCount > 0 && idx === recentCount;
            return (
              <div key={movement.id}>
                {isFirstRecent && (
                  <div className="px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Recent
                  </div>
                )}
                {isFirstAfterRecent && (
                  <div className="px-3 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    All movements
                  </div>
                )}
                <button
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
              </div>
            );
          })}

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
