"use client";

import {
  CATEGORY_FILTER_OPTIONS,
  type CategoryFilter,
} from "@/types/crossfit";

interface CategoryPillsProps {
  value: CategoryFilter;
  onChange: (next: CategoryFilter) => void;
  className?: string;
  /** Hide labels not in this set — useful when an "Accessory" or "Other"
   * pill would surface a category the page doesn't support. */
  allowedKeys?: CategoryFilter[];
}

/**
 * Horizontal-scrolling row of movement-category filter pills. Controlled —
 * the parent owns the active value. Used in the public movement library,
 * the workout-builder picker, and the admin movements page so any change
 * to the filter set propagates everywhere.
 */
export function CategoryPills({
  value,
  onChange,
  className,
  allowedKeys,
}: CategoryPillsProps) {
  const options = allowedKeys
    ? CATEGORY_FILTER_OPTIONS.filter((o) => allowedKeys.includes(o.key))
    : CATEGORY_FILTER_OPTIONS;

  return (
    <div
      className={`overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className ?? ""}`}
      role="tablist"
      aria-label="Filter by category"
    >
      <div className="flex gap-1.5">
        {options.map((opt) => {
          const active = value === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(opt.key)}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs transition-colors ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-transparent text-muted-foreground hover:bg-accent/50"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
