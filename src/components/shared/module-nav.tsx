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
    <nav className="flex gap-1 overflow-x-auto border-b border-border px-1 no-scrollbar">
      {items.map(({ href, label }) => {
        const isActive =
          href === items[0].href
            ? pathname === href // exact match for default tab
            : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "relative shrink-0 px-3 py-2.5 text-sm font-medium transition-colors",
              isActive
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
            {isActive && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
