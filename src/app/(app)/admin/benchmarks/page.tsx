import { notFound } from "next/navigation";
import { AdminBenchmarks } from "@/components/admin/admin-benchmarks";
import { AdminToolHeader } from "@/components/admin/admin-tool-header";
import { getAdminTool } from "@/lib/admin/tools";

export default function AdminBenchmarksPage() {
  const tool = getAdminTool("benchmarks");
  if (!tool) notFound();

  return (
    <div className="space-y-5">
      <AdminToolHeader label={tool.label} description={tool.description} icon={tool.icon} />
      <AdminBenchmarks />
    </div>
  );
}
