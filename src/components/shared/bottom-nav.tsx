"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dumbbell, Trophy, Clock, User } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/crossfit", label: "CrossFit", icon: Dumbbell },
  { href: "/hyrox", label: "HYROX", icon: Trophy },
  { href: "/history", label: "History", icon: Clock },
  { href: "/profile", label: "Profile", icon: User },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 glass border-t border-white/[0.06]">
      <div className="mx-auto flex max-w-lg items-center justify-around py-1">
        {tabs.map(({ href, label, icon: Icon }) => {
          const isActive = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-all duration-200",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground/70 hover:text-muted-foreground"
              )}
            >
              {isActive && (
                <span className="absolute -top-1 left-1/2 h-[3px] w-8 -translate-x-1/2 rounded-full bg-primary glow-primary-sm" />
              )}
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-200",
                  isActive && "bg-primary/10"
                )}
              >
                <Icon
                  className={cn(
                    "h-[18px] w-[18px] transition-all duration-200",
                    isActive && "stroke-[2.5] drop-shadow-[0_0_8px_oklch(0.85_0.20_130_/_40%)]"
                  )}
                />
              </div>
              <span className={cn(isActive && "font-semibold")}>{label}</span>
            </Link>
          );
        })}
      </div>
      {/* Safe area spacer for iOS */}
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
