// ---------------------------------------------------------------------------
// Admin section layout.
//
// Server component — gates every page under /admin. Super admins see all
// tools; active gym admins/coaches see the subset marked non-super-only
// (movements, benchmarks, recovery movements). Anyone else is redirected.
// Super-only sub-routes have their own layout gate under /admin/(super)/.
// ---------------------------------------------------------------------------

import { redirect } from "next/navigation";
import { getAdminAccess } from "@/lib/admin/access";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const access = await getAdminAccess();
  if (!access) redirect("/");

  return <div className="space-y-4">{children}</div>;
}
