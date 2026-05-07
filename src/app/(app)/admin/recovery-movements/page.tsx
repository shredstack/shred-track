import { notFound } from "next/navigation";
import { AdminRecoveryMovements } from "@/components/admin/admin-recovery-movements";
import { AdminToolHeader } from "@/components/admin/admin-tool-header";
import { getAdminTool } from "@/lib/admin/tools";

export default function AdminRecoveryMovementsPage() {
  const tool = getAdminTool("recovery-movements");
  if (!tool) notFound();

  return (
    <div className="space-y-5">
      <AdminToolHeader
        label={tool.label}
        description={tool.description}
        icon={tool.icon}
      />
      <AdminRecoveryMovements />
    </div>
  );
}
