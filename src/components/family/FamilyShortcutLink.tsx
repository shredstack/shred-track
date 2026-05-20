// Profile-page link to /profile/family. Hidden when the
// family_memberships flag is off for the user's active gym.

"use client";

import Link from "next/link";
import { ChevronRight, Users } from "lucide-react";
import { useIsFeatureOn } from "@/hooks/useFeatureFlag";

export function FamilyShortcutLink() {
  const enabled = useIsFeatureOn("family_memberships");
  if (!enabled) return null;
  return (
    <Link
      href="/profile/family"
      className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-sm transition-colors hover:bg-muted/40"
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
        <Users className="h-4 w-4 text-primary" />
      </div>
      <span className="flex-1 text-left font-medium">Family</span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </Link>
  );
}
