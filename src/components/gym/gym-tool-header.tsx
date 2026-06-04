import type { LucideIcon } from "lucide-react";
import { BackButton } from "@/components/shared/back-button";

interface GymToolHeaderProps {
  label: string;
  description?: string;
  icon: LucideIcon;
  backHref?: string;
  backLabel?: string;
}

export function GymToolHeader({
  label,
  description,
  icon: Icon,
  backHref = "/gym",
  backLabel = "Gym tools",
}: GymToolHeaderProps) {
  return (
    <div className="space-y-3">
      <BackButton fallbackHref={backHref} label={backLabel} />
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/40">
          <Icon className="size-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold leading-tight">{label}</h1>
          {description ? (
            <p className="text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
