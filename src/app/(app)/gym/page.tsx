// /gym — hub page for the active gym's coaches/admins. Shows quick
// links to member management, join-code rotation, and gym settings.

import Link from "next/link";
import {
  ChevronRight,
  FileText,
  Heart,
  KeyRound,
  Settings,
  Users,
} from "lucide-react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, communities } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canAdminGym, getGymRole } from "@/lib/authz/community";
import { Card, CardContent } from "@/components/ui/card";

interface Tool {
  href: string;
  label: string;
  description: string;
  icon: typeof Users;
  adminOnly: boolean;
}

const TOOLS: Tool[] = [
  {
    href: "/gym/members",
    label: "Members",
    description: "Promote coaches, deactivate members",
    icon: Users,
    adminOnly: true,
  },
  {
    href: "/gym/recovery",
    label: "Recovery adherence",
    description: "Per-athlete recovery completion stats",
    icon: Heart,
    adminOnly: false,
  },
  {
    href: "/gym/join-code",
    label: "Join code",
    description: "View, rotate, or set a custom code",
    icon: KeyRound,
    adminOnly: true,
  },
  {
    href: "/gym/documents",
    label: "Documents",
    description: "Waivers, policies, and member signatures",
    icon: FileText,
    adminOnly: true,
  },
  {
    href: "/gym/settings",
    label: "Settings",
    description: "Rename your gym",
    icon: Settings,
    adminOnly: true,
  },
];

export default async function GymHubPage() {
  const user = await getSessionUser();
  // Layout already ensured user + active gym + program access. We re-fetch
  // here so the page can show the gym name.
  const [row] = await db
    .select({ activeCommunityId: users.activeCommunityId })
    .from(users)
    .where(eq(users.id, user!.id))
    .limit(1);
  const activeId = row!.activeCommunityId!;
  const [community] = await db
    .select()
    .from(communities)
    .where(eq(communities.id, activeId))
    .limit(1);
  const role = await getGymRole(user!.id, activeId);
  const isAdmin = await canAdminGym(user!.id, activeId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{community?.name ?? "Your gym"}</h1>
        <p className="text-sm text-muted-foreground">
          {role?.isAdmin
            ? "Gym admin"
            : role?.isCoach
            ? "Coach"
            : "Member"}{" "}
          tools — manage your gym from here.
        </p>
      </div>

      <div className="space-y-2">
        {TOOLS.filter((t) => !t.adminOnly || isAdmin).map((tool) => {
          const Icon = tool.icon;
          return (
            <Link key={tool.href} href={tool.href}>
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
        {!isAdmin && (
          <p className="text-[11px] text-muted-foreground px-2 pt-2">
            Coach-only view. Member management, join code, and settings are
            visible to gym admins only.
          </p>
        )}
      </div>
    </div>
  );
}
