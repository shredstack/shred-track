"use client";

// Full-screen leaderboard shell. Thin wrapper around the generic
// FullScreenSheet that wires a Trophy icon for the leaderboard's identity.

import { Trophy } from "lucide-react";
import { FullScreenSheet } from "@/components/ui/full-screen-sheet";

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
    <FullScreenSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      icon={Trophy}
      subtitle={subtitle}
      headerExtra={headerExtra}
    >
      {children}
    </FullScreenSheet>
  );
}
