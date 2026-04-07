"use client";

import { ModuleNav } from "@/components/shared/module-nav";

const crossfitNav = [
  { href: "/crossfit", label: "WODs" },
  { href: "/crossfit/benchmarks", label: "Benchmarks" },
  { href: "/crossfit/movements", label: "Movements" },
  { href: "/crossfit/insights", label: "Insights" },
];

export default function CrossfitLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <ModuleNav items={crossfitNav} />
      {children}
    </div>
  );
}
