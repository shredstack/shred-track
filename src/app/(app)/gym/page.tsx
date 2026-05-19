// /gym — hub page for the active gym's coaches/admins. Shows quick
// links to member management, join-code rotation, and gym settings.

import Link from "next/link";
import {
  CalendarDays,
  CalendarRange,
  ChevronRight,
  ClipboardList,
  FileText,
  Heart,
  KeyRound,
  Megaphone,
  Settings,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, communities } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canAdminGym, getGymRole } from "@/lib/authz/community";
import { requireGymAdminOrRedirect } from "@/lib/authz/require-gym-admin";
import { Card, CardContent } from "@/components/ui/card";

interface Tool {
  href: string;
  label: string;
  description: string;
  icon: typeof Users;
  adminOnly: boolean;
  group: "programming" | "members" | "settings";
}

const TOOLS: Tool[] = [
  // Programming
  {
    href: "/gym/programming",
    label: "Programming",
    description: "Build the week — warm-up, skill, WOD, cool-down",
    icon: ClipboardList,
    adminOnly: false,
    group: "programming",
  },
  {
    href: "/gym/programming/tracks",
    label: "Tracks",
    description: "Monthly challenges and event-prep tracks",
    icon: Sparkles,
    adminOnly: false,
    group: "programming",
  },
  {
    href: "/gym/classes",
    label: "Classes",
    description: "Today's roster and attendance",
    icon: CalendarDays,
    adminOnly: false,
    group: "programming",
  },
  {
    href: "/gym/classes/schedules",
    label: "Class schedules",
    description: "Weekly recurring class slots",
    icon: CalendarRange,
    adminOnly: true,
    group: "programming",
  },
  {
    href: "/gym/events",
    label: "Events",
    description: "Murph, partner WODs, fundraisers",
    icon: CalendarDays,
    adminOnly: false,
    group: "programming",
  },
  // Members
  {
    href: "/gym/members",
    label: "Members",
    description: "Promote coaches, deactivate members",
    icon: Users,
    adminOnly: true,
    group: "members",
  },
  {
    href: "/gym/committed-club",
    label: "Committed Club",
    description: "Monthly leaderboard and streaks",
    icon: Trophy,
    adminOnly: false,
    group: "members",
  },
  {
    href: "/gym/social",
    label: "Social feed",
    description: "Announcements, whiteboard, auto-posts",
    icon: Megaphone,
    adminOnly: false,
    group: "members",
  },
  {
    href: "/gym/recovery",
    label: "Recovery adherence",
    description: "Per-athlete recovery completion stats",
    icon: Heart,
    adminOnly: false,
    group: "members",
  },
  // Settings
  {
    href: "/gym/join-code",
    label: "Join code",
    description: "View, rotate, or set a custom code",
    icon: KeyRound,
    adminOnly: true,
    group: "settings",
  },
  {
    href: "/gym/documents",
    label: "Documents",
    description: "Waivers, policies, and member signatures",
    icon: FileText,
    adminOnly: true,
    group: "settings",
  },
  {
    href: "/gym/settings",
    label: "Settings",
    description: "Name, website, branding, admin email",
    icon: Settings,
    adminOnly: true,
    group: "settings",
  },
];

const GROUP_LABELS: Record<Tool["group"], string> = {
  programming: "Programming",
  members: "Members & community",
  settings: "Gym settings",
};

export default async function GymHubPage() {
  // The hub itself is admin/coach-only — the parent layout now only
  // enforces membership so the social feed and committed-club work for
  // regular members. Re-gate the hub here.
  await requireGymAdminOrRedirect();
  const user = await getSessionUser();
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

      {(["programming", "members", "settings"] as Tool["group"][]).map(
        (group) => {
          const tools = TOOLS.filter(
            (t) => t.group === group && (!t.adminOnly || isAdmin)
          );
          if (!tools.length) return null;
          return (
            <div key={group} className="space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 px-1">
                {GROUP_LABELS[group]}
              </p>
              {tools.map((tool) => {
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
            </div>
          );
        }
      )}
      {!isAdmin && (
        <p className="text-[11px] text-muted-foreground px-2 pt-2">
          Coach-only view. Member management, join code, documents, and
          settings are visible to gym admins only.
        </p>
      )}
    </div>
  );
}
