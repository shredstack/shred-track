import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";

interface AdminToolHeaderProps {
  label: string;
  description: string;
  icon: LucideIcon;
}

export function AdminToolHeader({ label, description, icon: Icon }: AdminToolHeaderProps) {
  return (
    <div className="space-y-3">
      <Link
        href="/admin"
        className={buttonVariants({ variant: "ghost", size: "sm" }) + " self-start -ml-2"}
      >
        <ArrowLeft className="size-4" />
        Admin
      </Link>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/40">
          <Icon className="size-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold leading-tight">{label}</h1>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}
