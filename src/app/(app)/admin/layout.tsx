// ---------------------------------------------------------------------------
// Admin section layout.
//
// Server component — gates every page under /admin behind the admin role.
// Non-admins are redirected away before the route renders, so admin tools
// don't need to repeat the check on the client. Tool-specific API routes
// still re-check (defense in depth).
// ---------------------------------------------------------------------------

import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/admin";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await getAdminUser();
  if (!admin) redirect("/");

  return <div className="space-y-4">{children}</div>;
}
