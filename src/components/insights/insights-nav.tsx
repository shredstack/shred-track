"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { BarChart3, Calculator, Timer } from "lucide-react";

const NAV_ITEMS = [
  { href: "/insights/hyrox", label: "Insights", icon: BarChart3 },
  { href: "/insights/hyrox/calculator", label: "Calculator", icon: Calculator },
  { href: "/insights/hyrox/timer", label: "Race Timer", icon: Timer },
] as const;

export function InsightsNav() {
  const pathname = usePathname();

  return (
    <nav className="flex rounded-lg bg-white/[0.03] p-1 gap-0.5 overflow-x-auto">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const isActive = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center justify-center gap-1.5 rounded-md px-2.5 py-2 text-[11px] font-medium transition-all duration-200 whitespace-nowrap ${
              isActive
                ? "bg-primary/15 text-primary glow-primary-sm"
                : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
