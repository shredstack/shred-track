import { notFound } from "next/navigation";
import { AdminHyroxVip } from "@/components/admin/admin-hyrox-vip";
import { AdminToolHeader } from "@/components/admin/admin-tool-header";
import { getAdminTool } from "@/lib/admin/tools";

export default function AdminHyroxVipPage() {
  const tool = getAdminTool("hyrox-vip");
  if (!tool) notFound();

  return (
    <div className="space-y-5">
      <AdminToolHeader label={tool.label} description={tool.description} icon={tool.icon} />
      <AdminHyroxVip />
    </div>
  );
}
