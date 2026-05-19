// Home tab placeholder (spec §1.5).
//
// Full build lands in PR 2 (§2.1). For now this just renders a Today card
// linking into the CrossFit day view so the new bottom-nav tab isn't dead.

import Link from "next/link";
import { ArrowRight, Dumbbell } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function HomePage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Home</h1>
        <p className="text-sm text-muted-foreground">
          Your day at a glance.
        </p>
      </div>

      <Card className="gradient-border">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Today
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Link
            href="/crossfit"
            className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 transition-colors hover:bg-white/[0.06]"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
              <Dumbbell className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium">Today&apos;s WOD</div>
              <div className="text-xs text-muted-foreground">
                Open the CrossFit tab to see today&apos;s programming.
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </CardContent>
      </Card>

      <p className="px-1 text-[11px] text-muted-foreground/70">
        More cards coming soon — gym social, classes, Committed Club progress.
      </p>
    </div>
  );
}
