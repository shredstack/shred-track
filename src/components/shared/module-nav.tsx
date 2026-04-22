"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface ModuleNavItem {
  href: string;
  label: string;
}

export function ModuleNav({ items }: { items: ModuleNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex w-full gap-1 px-0.5 py-1">
      {items.map(({ href, label }) => {
        const isActive =
          href === items[0].href
            ? pathname === href
            : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "relative flex-1 min-w-0 rounded-lg px-1.5 py-1.5 text-center text-xs font-medium leading-tight transition-all duration-200 sm:px-3 sm:text-sm",
              isActive
                ? "bg-primary/15 text-primary glow-primary-sm"
                : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
