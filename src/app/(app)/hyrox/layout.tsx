"use client";

import { ModuleNav } from "@/components/shared/module-nav";

const hyroxNav = [
  { href: "/hyrox", label: "Dashboard" },
  { href: "/hyrox/plan", label: "Plan" },
  { href: "/hyrox/race-tools", label: "Race Tools" },
  { href: "/hyrox/benchmarks", label: "Benchmarks" },
  { href: "/hyrox/explore", label: "Explore" },
];

export default function HyroxLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <ModuleNav items={hyroxNav} />
      {children}
    </div>
  );
}
