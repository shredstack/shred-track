import { notFound } from "next/navigation";
import { AdminUsersVip } from "@/components/admin/admin-users-vip";
import { AdminToolHeader } from "@/components/admin/admin-tool-header";
import { getAdminTool } from "@/lib/admin/tools";

export default function AdminVipsPage() {
  const tool = getAdminTool("vips");
  if (!tool) notFound();

  return (
    <div className="space-y-5">
      <AdminToolHeader label={tool.label} description={tool.description} icon={tool.icon} />
      <AdminUsersVip />
    </div>
  );
}
