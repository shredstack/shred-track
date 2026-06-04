import { notFound, redirect } from "next/navigation";
import { AdminStimulusProfiles } from "@/components/admin/admin-stimulus-profiles";
import { AdminToolHeader } from "@/components/admin/admin-tool-header";
import { getAdminAccess } from "@/lib/admin/access";
import { getAdminTool } from "@/lib/admin/tools";

// Super-admin only — these bands apply across the whole product. The API
// is gated the same way; this redirect keeps a URL-guessing gym admin
// from landing on a broken-by-403 page.
export default async function AdminStimulusProfilesPage() {
  const tool = getAdminTool("stimulus-profiles");
  if (!tool) notFound();

  const access = await getAdminAccess();
  if (!access) redirect("/");
  if (!access.isSuperAdmin) redirect("/admin");

  return (
    <div className="space-y-5">
      <AdminToolHeader
        label={tool.label}
        description={tool.description}
        icon={tool.icon}
      />
      <AdminStimulusProfiles />
    </div>
  );
}
