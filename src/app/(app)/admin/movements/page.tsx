import { notFound } from "next/navigation";
import { AdminMovements } from "@/components/admin/admin-movements";
import { AdminToolHeader } from "@/components/admin/admin-tool-header";
import { getAdminTool } from "@/lib/admin/tools";

export default function AdminMovementsPage() {
  const tool = getAdminTool("movements");
  if (!tool) notFound();

  return (
    <div className="space-y-5">
      <AdminToolHeader label={tool.label} description={tool.description} icon={tool.icon} />
      <AdminMovements />
    </div>
  );
}
