// ---------------------------------------------------------------------------
// useAdminAccess — client-side mirror of getAdminAccess() in lib/admin/access.
//
// One hook for every UI surface that asks "should I show an admin entry
// point?" Nav (side/bottom), Profile, Recovery "Manage" link all consume
// this so future changes to the tier definitions propagate everywhere.
//
// Reads from the existing /api/me/gym-context query — no extra network
// hops. Server-side gates in /admin/layout enforce the real boundary; this
// hook just decides whether to render the link.
// ---------------------------------------------------------------------------

"use client";

import { useMemo } from "react";
import { useGymContext } from "@/hooks/useGymContext";

export interface AdminAccess {
  isSuperAdmin: boolean;
  /** True for super admins and for any active gym admin/coach. */
  canAccessAdmin: boolean;
}

export function useAdminAccess(): AdminAccess {
  const { data } = useGymContext();
  return useMemo(() => {
    const isSuperAdmin = !!data?.user.isSuperAdmin;
    const hasStaffRole = !!data?.memberships.some(
      (m) => m.isActive && (m.isAdmin || m.isCoach)
    );
    return {
      isSuperAdmin,
      canAccessAdmin: isSuperAdmin || hasStaffRole,
    };
  }, [data]);
}
