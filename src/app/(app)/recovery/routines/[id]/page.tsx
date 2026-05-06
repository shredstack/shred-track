"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useRecoveryRoutine } from "@/hooks/useRecoveryRoutines";
import { formatPrescription } from "@/types/recovery";

export default function RoutineDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, isLoading } = useRecoveryRoutine(id);

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/recovery/routines"
        className="inline-flex items-center text-xs text-muted-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5 mr-1" />
        Back
      </Link>
      <div>
        <h1 className="text-xl font-bold">{data.name}</h1>
        {data.description && (
          <p className="text-sm text-muted-foreground mt-1">{data.description}</p>
        )}
      </div>

      <div className="space-y-2">
        {data.movements?.map((m, i) => (
          <Card key={m.id}>
            <CardContent className="py-3">
              <div className="flex items-start gap-2">
                <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
                <div className="flex-1">
                  <p className="text-sm font-medium">{m.movementName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatPrescription(m.prescription, m.isPerSide ?? false) || "—"}
                  </p>
                  {m.notes && <p className="text-[11px] italic text-muted-foreground">{m.notes}</p>}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
