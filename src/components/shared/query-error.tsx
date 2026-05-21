"use client";

import { RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface QueryErrorProps {
  /** Wire to React Query's `refetch`. The retry button is hidden when omitted. */
  onRetry?: () => void;
  /** True while a retry request is in flight — spins the icon and disables the
   *  button. Pass the query's `isFetching`. */
  retrying?: boolean;
  /** Headline. Defaults to a connection-focused message. */
  title?: string;
  /** Sub-text under the headline. */
  description?: string;
  className?: string;
}

/**
 * Standard "couldn't load" state for a failed React Query fetch.
 *
 * Use this instead of letting a failed request fall through to an empty state:
 * a failed request and a genuinely empty result must look different, otherwise
 * a flaky connection reads as "you have no data".
 */
export function QueryError({
  onRetry,
  retrying = false,
  title = "Couldn't load",
  description = "Check your connection and try again.",
  className,
}: QueryErrorProps) {
  return (
    <Card className={cn("border-dashed border-white/[0.06]", className)}>
      <CardContent className="flex flex-col items-center gap-4 py-10">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10">
          <WifiOff className="h-6 w-6 text-destructive/70" />
        </div>
        <div className="text-center">
          <p className="font-semibold">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {onRetry && (
          <Button
            variant="outline"
            className="mt-1 border-white/[0.08]"
            onClick={onRetry}
            disabled={retrying}
          >
            <RefreshCw className={cn("h-4 w-4", retrying && "animate-spin")} />
            {retrying ? "Retrying…" : "Try again"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
