"use client";

// Full-screen sheet container shared by the workout leaderboard and the
// track-day (monthly challenge / custom track) leaderboard. Takes the
// whole viewport so athletes can browse a long list of scores without the
// cramped 90vh bottom-sheet UX, and gives the body a single vertical
// scroll area instead of nested scrollers.

import { Trophy } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface LeaderboardShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string | null;
  children: React.ReactNode;
  /** Optional slot rendered inside the sticky header (e.g. tabs for parts). */
  headerExtra?: React.ReactNode;
}

export function LeaderboardShell({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  headerExtra,
}: LeaderboardShellProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="inset-0 h-[100dvh] max-h-none w-full rounded-none border-0 p-0 gap-0 flex flex-col"
      >
        <SheetHeader className="shrink-0 border-b border-white/[0.06] bg-background/95 px-4 pt-4 pb-3 backdrop-blur supports-backdrop-filter:bg-background/80">
          <div className="flex items-center gap-2 pr-10">
            <Trophy className="size-4 text-primary shrink-0" />
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
