// ---------------------------------------------------------------------------
// Super-admin-only sub-section of /admin.
//
// Wraps tools that only super admins can use (Gyms, Feature Flags, VIPs,
// HYROX VIP). The parent /admin layout already gated for "any admin", so
// this layer just rejects gym admins/coaches.
//
// Route group (super) does not affect URLs — the routes still resolve at
// /admin/<slug>.
// ---------------------------------------------------------------------------

import { redirect } from "next/navigation";
import { getAdminAccess } from "@/lib/admin/access";

export default async function AdminSuperLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const access = await getAdminAccess();
  if (!access?.isSuperAdmin) redirect("/admin");

  return <>{children}</>;
}
