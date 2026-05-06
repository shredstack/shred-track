"use client";

import Link from "next/link";
import { ArrowLeft, Loader2, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  useRecoveryMovements,
  useValidateRecoveryMovement,
} from "@/hooks/useRecoveryMovements";

export default function AdminPendingPage() {
  const { data, isLoading } = useRecoveryMovements({ pendingOnly: true });
  const validate = useValidateRecoveryMovement();

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/recovery"
        className="inline-flex items-center text-xs text-muted-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5 mr-1" />
        Today
      </Link>
      <h1 className="text-lg font-semibold">Pending validation</h1>
      <p className="text-xs text-muted-foreground">
        Member-submitted movements waiting for promotion. Once validated they
        appear in the library for everyone in the gym.
      </p>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : !data || data.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nothing pending.
          </CardContent>
        </Card>
      ) : (
        data.map((m) => (
          <Card key={m.id}>
            <CardContent className="py-3 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <Link href={`/recovery/movements/${m.id}`} className="text-sm font-medium hover:underline">
                  {m.canonicalName}
                </Link>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {m.category} · submitted by user {m.createdBy?.slice(0, 8) ?? "?"}…
                </p>
              </div>
              <Button
                size="sm"
                onClick={() =>
                  validate.mutate(m.id, {
                    onSuccess: () => toast.success("Validated"),
                    onError: (e) => toast.error(e.message),
                  })
                }
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                Validate
              </Button>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
