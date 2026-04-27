"use client";

import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import {
  DIVISIONS,
  DIVISION_CATEGORIES,
  type DivisionKey,
  type DivisionCategoryGroup,
} from "@/lib/hyrox-data";
import { PickerSheet } from "@/components/shared/picker-sheet";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DivisionPickerProps {
  value: DivisionKey;
  onChange: (key: DivisionKey) => void;
  /** Only show divisions matching this gender (for onboarding context) */
  genderFilter?: "women" | "men" | null;
  /** Limit to specific division keys (e.g. insights only has 4 divisions with data) */
  allowedKeys?: DivisionKey[];
  /** Compact mode shows just the trigger button — no inline expansion */
  compact?: boolean;
  /** Label shown above the picker */
  label?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DivisionPicker({
  value,
  onChange,
  genderFilter = null,
  allowedKeys,
  label,
}: DivisionPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const selectedLabel = DIVISIONS[value]?.label ?? "Select division";

  // Find which category the current value belongs to
  const activeCategory = useMemo(
    () => DIVISION_CATEGORIES.find((cat) => cat.keys.includes(value))?.label ?? "",
    [value],
  );

  // Filter categories/keys based on props
  const filteredCategories = useMemo(() => {
    const lowerSearch = search.toLowerCase().trim();

    return DIVISION_CATEGORIES.map((cat) => {
      let keys = cat.keys;

      // Apply gender filter
      if (genderFilter) {
        keys = keys.filter((k) => {
          if (genderFilter === "women")
            return k.includes("women") || k.includes("mixed") || k.includes("girls");
          if (genderFilter === "men")
            return k.includes("men") || k.includes("mixed") || k.includes("boys");
          return true;
        });
      }

      // Apply allowed keys filter
      if (allowedKeys) {
        keys = keys.filter((k) => allowedKeys.includes(k));
      }

      // Apply search filter
      if (lowerSearch) {
        keys = keys.filter(
          (k) =>
            DIVISIONS[k].label.toLowerCase().includes(lowerSearch) ||
            cat.label.toLowerCase().includes(lowerSearch),
        );
      }

      return { ...cat, keys };
    }).filter((cat) => cat.keys.length > 0);
  }, [genderFilter, allowedKeys, search]);

  const handleSelect = useCallback(
    (key: DivisionKey) => {
      onChange(key);
      setIsOpen(false);
      setSearch("");
    },
    [onChange],
  );

  const handleOpenChange = useCallback((next: boolean) => {
    setIsOpen(next);
    if (!next) setSearch("");
  }, []);

  // Defer focus until after the entrance animation so iOS reliably shows the
  // keyboard.
  useEffect(() => {
    if (!isOpen) return;
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [isOpen]);

  // If allowedKeys is small (≤6), render inline pills instead of the dropdown
  if (allowedKeys && allowedKeys.length <= 6) {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
        )}
        <div className="flex flex-wrap gap-1.5">
          {allowedKeys.map((key) => (
            <button
              key={key}
              onClick={() => onChange(key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                value === key
                  ? "bg-primary/15 text-primary glow-primary-sm"
                  : "bg-white/[0.04] text-muted-foreground hover:bg-white/[0.08] hover:text-foreground"
              }`}
            >
              {DIVISIONS[key].label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      )}

      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="w-full flex items-center justify-between rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2.5 text-sm font-medium hover:bg-white/[0.06] transition-colors"
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      <PickerSheet
        open={isOpen}
        onOpenChange={handleOpenChange}
        title="Select Division"
      >
        {/* Search input */}
        <div className="px-4 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search divisions..."
              autoComplete="off"
              enterKeyHint="search"
              className="w-full rounded-lg bg-white/[0.04] border border-white/[0.08] pl-8 pr-8 py-2 text-sm placeholder:text-muted-foreground outline-none focus:border-primary/40"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Division list by category */}
        <div className="flex-1 overflow-y-auto pb-4">
          {filteredCategories.length === 0 && (
            <p className="px-3 py-6 text-xs text-muted-foreground text-center">
              No divisions match your search.
            </p>
          )}

          {filteredCategories.map((cat) => (
            <CategoryGroup
              key={cat.label}
              category={cat}
              activeKey={value}
              activeCategory={activeCategory}
              onSelect={handleSelect}
            />
          ))}
        </div>
      </PickerSheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category group with collapsible header
// ---------------------------------------------------------------------------

const CategoryGroup = React.memo(function CategoryGroup({
  category,
  activeKey,
  activeCategory,
  onSelect,
}: {
  category: DivisionCategoryGroup;
  activeKey: DivisionKey;
  activeCategory: string;
  onSelect: (key: DivisionKey) => void;
}) {
  const hasActive = category.label === activeCategory;
  // Auto-expand the category that contains the active division, or if searching
  const [expanded, setExpanded] = useState(hasActive);

  return (
    <div className="border-b border-white/[0.04] last:border-0">
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className={`w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors ${
          hasActive ? "bg-primary/[0.04]" : "hover:bg-white/[0.03]"
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`text-xs font-semibold truncate ${hasActive ? "text-primary" : ""}`}
          >
            {category.label}
          </span>
          <span className="text-[10px] text-muted-foreground truncate">
            {category.description}
          </span>
        </div>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {expanded && (
        <div className="flex flex-wrap gap-1.5 px-3 pb-2.5">
          {category.keys.map((key) => {
            const div = DIVISIONS[key];
            const shortLabel = div.label
              .replace(/^(Women|Men|Girls|Boys|Mixed)\s+/, "$1 ")
              .replace(category.label + " ", "");

            return (
              <button
                key={key}
                onClick={() => onSelect(key)}
                className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-all duration-200 ${
                  activeKey === key
                    ? "bg-primary/15 text-primary glow-primary-sm"
                    : "bg-white/[0.03] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
                }`}
              >
                {shortLabel}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});
