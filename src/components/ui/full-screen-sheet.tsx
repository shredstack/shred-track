"use client";

// Full-screen bottom sheet shell. A generic version of the pattern used by
// the workout leaderboard — takes the whole viewport so long lists can
// scroll without the cramped 85vh feel, with a sticky header carrying a
// title + icon + optional subtitle and an optional headerExtra slot for
// tabs / filters.

import type { LucideIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface FullScreenSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  icon?: LucideIcon;
  subtitle?: string | null;
  /** Optional slot rendered inside the sticky header (e.g. tab strip). */
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}

export function FullScreenSheet({
  open,
  onOpenChange,
  title,
  icon: Icon,
  subtitle,
  headerExtra,
  children,
}: FullScreenSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="inset-0 h-[100dvh] max-h-none w-full rounded-none border-0 p-0 gap-0 flex flex-col"
      >
        <SheetHeader className="shrink-0 border-b border-white/[0.06] bg-background/95 px-4 pt-4 pb-3 backdrop-blur supports-backdrop-filter:bg-background/80">
          <div className="flex items-center gap-2 pr-10">
            {Icon && <Icon className="size-4 text-primary shrink-0" />}
            <SheetTitle className="truncate text-base">{title}</SheetTitle>
          </div>
          {subtitle && (
            <p className="text-xs text-muted-foreground pr-10">{subtitle}</p>
          )}
          {headerExtra && <div className="pt-2">{headerExtra}</div>}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
