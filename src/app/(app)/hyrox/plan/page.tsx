import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import HyroxPlanContent from "./plan-content";

export const dynamic = "force-dynamic";

export default function HyroxPlanPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <HyroxPlanContent />
    </Suspense>
  );
}
