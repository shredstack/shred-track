"use client";

import Link from "next/link";
import { Loader2, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useRecoveryRoutines } from "@/hooks/useRecoveryRoutines";

export default function RecoveryRoutinesPage() {
  const { data, isLoading } = useRecoveryRoutines();

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-lg font-semibold">Routines</h1>
      <p className="text-xs text-muted-foreground">
        Composite movements bundled together. Drop one into a schedule and it
        expands into all of its child movements when you log the day.
      </p>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : !data || data.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No routines yet. (Coming soon: a routine builder.)
          </CardContent>
        </Card>
      ) : (
        data.map((r) => (
          <Link key={r.id} href={`/recovery/routines/${r.id}`}>
            <Card className="hover:bg-muted/30 transition-colors">
              <CardContent className="flex items-center gap-3 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{r.name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-[10px]">
                      {r.movements?.length ?? 0} movements
                    </Badge>
                    {!r.isValidated && (
                      <Badge variant="secondary" className="text-[10px]">
                        Pending
                      </Badge>
                    )}
                  </div>
                </div>
                <ChevronRight className="size-4 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        ))
      )}
    </div>
  );
}
