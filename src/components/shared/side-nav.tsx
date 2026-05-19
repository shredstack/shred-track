"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  ClipboardList,
  Dumbbell,
  Heart,
  Home,
  Trophy,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsRacing } from "@/hooks/useRaceMode";
import { useIsCoachMode } from "@/hooks/useCoachMode";
import { useIsFeatureOn } from "@/hooks/useFeatureFlag";
import { useActiveMembership } from "@/hooks/useGymContext";

interface NavTab {
  href: string;
  label: string;
  icon: LucideIcon;
}

const baseMemberTabs: NavTab[] = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/crossfit", label: "CrossFit", icon: Dumbbell },
  { href: "/hyrox", label: "HYROX", icon: Trophy },
  { href: "/recovery", label: "Recovery", icon: Heart },
  { href: "/profile", label: "Profile", icon: User },
];

const coachTabs: NavTab[] = [
  { href: "/gym/programming", label: "Programming", icon: ClipboardList },
  { href: "/gym/classes", label: "Classes", icon: CalendarDays },
  { href: "/gym/members", label: "Roster", icon: Users },
  { href: "/profile", label: "Profile", icon: User },
];

export function SideNav() {
  const pathname = usePathname();
  const isRacing = useIsRacing();
  const isCoachMode = useIsCoachMode();
  const classesOn = useIsFeatureOn("classes");
  const activeMembership = useActiveMembership();
  const memberTabs: NavTab[] =
    classesOn && activeMembership
      ? [
          baseMemberTabs[0],
          { href: "/classes", label: "Classes", icon: CalendarDays },
          ...baseMemberTabs.slice(1),
        ]
      : baseMemberTabs;
  const tabs = isCoachMode ? coachTabs : memberTabs;

  if (isRacing) return null;

  return (
    <aside className="hidden md:flex md:w-60 md:shrink-0">
      <nav className="sticky top-14 flex h-[calc(100vh-3.5rem)] w-full flex-col gap-1 border-r border-white/[0.06] glass px-3 py-6">
        {tabs.map(({ href, label, icon: Icon }) => {
          const isActive = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground/80 hover:bg-white/[0.04] hover:text-foreground"
              )}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-primary glow-primary-sm" />
              )}
              <Icon
                className={cn(
                  "h-[18px] w-[18px] transition-all duration-200",
                  isActive &&
                    "stroke-[2.5] drop-shadow-[0_0_8px_oklch(0.85_0.20_130_/_40%)]"
                )}
              />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
