// ---------------------------------------------------------------------------
// Admin tool registry.
//
// Single source of truth for the admin dashboard at /admin. Each entry
// renders as a card on the dashboard and as a sub-page at /admin/<slug>.
//
// Adding a new admin tool:
//   1. Append an entry below.
//   2. Create src/app/(app)/admin/<slug>/page.tsx that renders the tool's
//      component. Wrap with the existing admin layout — auth is handled
//      one level up.
//
// Groups are used to visually section the dashboard. Add a new group key to
// ADMIN_GROUPS and reference it from the tool's `group` field.
// ---------------------------------------------------------------------------

import {
  Building,
  Crown,
  Dumbbell,
  HeartPulse,
  Sparkles,
  Trophy,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type AdminGroup = "crossfit" | "hyrox" | "recovery" | "users";

export interface AdminGroupMeta {
  label: string;
  description: string;
  icon: LucideIcon;
}

export const ADMIN_GROUPS: Record<AdminGroup, AdminGroupMeta> = {
  crossfit: {
    label: "CrossFit",
    description: "Movement library and benchmark workouts",
    icon: Dumbbell,
  },
  hyrox: {
    label: "HYROX",
    description: "Plan allowances and HYROX-specific tooling",
    icon: Zap,
  },
  recovery: {
    label: "Recovery",
    description: "Mobility, stretching, and recovery movements",
    icon: HeartPulse,
  },
  users: {
    label: "Users",
    description: "Access flags and account-level controls",
    icon: Users,
  },
};

export interface AdminTool {
  slug: string;
  label: string;
  description: string;
  icon: LucideIcon;
  group: AdminGroup;
}

export const ADMIN_TOOLS: AdminTool[] = [
  {
    slug: "movements",
    label: "Movements",
    description: "Validate user submissions, edit, and add canonical movements",
    icon: Dumbbell,
    group: "crossfit",
  },
  {
    slug: "benchmarks",
    label: "Benchmarks",
    description: "Manage canonical benchmark workouts (Girls, Heroes, etc.)",
    icon: Trophy,
    group: "crossfit",
  },
  {
    slug: "gyms",
    label: "Gyms",
    description: "Create gyms and assign gym admins",
    icon: Building,
    group: "users",
  },
  {
    slug: "vips",
    label: "VIPs",
    description: "Grant blanket VIP access to users (free paid features)",
    icon: Crown,
    group: "users",
  },
  {
    slug: "hyrox-vip",
    label: "HYROX Plan VIP",
    description: "Metered HYROX plan allowance per user",
    icon: Sparkles,
    group: "hyrox",
  },
  {
    slug: "recovery-movements",
    label: "Recovery Movements",
    description: "Validate user submissions, edit, delete, and manage videos",
    icon: HeartPulse,
    group: "recovery",
  },
];

export function getAdminTool(slug: string): AdminTool | undefined {
  return ADMIN_TOOLS.find((t) => t.slug === slug);
}

export function groupAdminTools(): Record<AdminGroup, AdminTool[]> {
  const grouped = { crossfit: [], hyrox: [], recovery: [], users: [] } as Record<
    AdminGroup,
    AdminTool[]
  >;
  for (const tool of ADMIN_TOOLS) grouped[tool.group].push(tool);
  return grouped;
}
