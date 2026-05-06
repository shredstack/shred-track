"use client";

import { ModuleNav } from "@/components/shared/module-nav";

const recoveryNav = [
  { href: "/recovery", label: "Today" },
  { href: "/recovery/schedules", label: "Schedules" },
  { href: "/recovery/movements", label: "Movements" },
  { href: "/recovery/routines", label: "Routines" },
  { href: "/recovery/history", label: "History" },
];

export default function RecoveryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <ModuleNav items={recoveryNav} />
      {children}
    </div>
  );
}
