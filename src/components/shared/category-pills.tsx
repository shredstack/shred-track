"use client";

export interface PillOption<K extends string> {
  key: K;
  label: string;
}

interface CategoryPillsProps<K extends string> {
  value: K;
  onChange: (next: K) => void;
  options: readonly PillOption<K>[];
  className?: string;
  ariaLabel?: string;
}

/**
 * Horizontal-scrolling row of filter pills. Controlled — the parent owns the
 * active value and supplies the option set. Used in the public movement
 * library, the workout-builder picker, the admin movements page, and the
 * recovery library so any change to the look/feel propagates everywhere.
 */
export function CategoryPills<K extends string>({
  value,
  onChange,
  options,
  className,
  ariaLabel = "Filter",
}: CategoryPillsProps<K>) {
  return (
    <div
      className={`overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className ?? ""}`}
      role="tablist"
      aria-label={ariaLabel}
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
