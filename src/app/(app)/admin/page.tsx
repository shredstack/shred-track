// ---------------------------------------------------------------------------
// Admin dashboard.
//
// Card grid driven by the registry in src/lib/admin/tools.ts. To add a new
// admin tool, append to ADMIN_TOOLS and create the corresponding route file
// at src/app/(app)/admin/<slug>/page.tsx.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ADMIN_GROUPS, groupAdminTools, type AdminGroup } from "@/lib/admin/tools";

export default function AdminPage() {
  const grouped = groupAdminTools();
  const orderedGroups = Object.keys(ADMIN_GROUPS) as AdminGroup[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Tools for managing canonical data and user access
        </p>
      </div>

      {orderedGroups.map((groupKey) => {
        const tools = grouped[groupKey];
        if (tools.length === 0) return null;
        const groupMeta = ADMIN_GROUPS[groupKey];
        const GroupIcon = groupMeta.icon;

        return (
          <section key={groupKey} className="space-y-2">
            <div className="flex items-center gap-2">
              <GroupIcon className="size-4 text-muted-foreground" />
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {groupMeta.label}
              </h2>
            </div>
            <div className="space-y-2">
              {tools.map((tool) => {
                const Icon = tool.icon;
                return (
                  <Link key={tool.slug} href={`/admin/${tool.slug}`}>
                    <Card className="hover:bg-muted/30 transition-colors">
                      <CardContent className="flex items-center gap-3 py-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/40">
                          <Icon className="size-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{tool.label}</p>
                          <p className="text-[11px] text-muted-foreground line-clamp-2">
                            {tool.description}
                          </p>
                        </div>
                        <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
