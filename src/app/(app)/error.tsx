"use client";

// Route-level error boundary for the authenticated app shell.
//
// Without this, any uncaught error while rendering a page under (app)/ falls
// through to Next's built-in global error page ("This page couldn't load" /
// "A server error occurred"), which blanks the entire app. This boundary
// keeps the nav + chrome from (app)/layout.tsx and offers in-place recovery.

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the error for the console / client monitoring. Server errors
    // only carry a digest here — the full stack lives in the server logs,
    // matchable by that digest.
    console.error("App route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-sm border-dashed border-white/[0.06]">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive/70" />
          </div>
          <div>
            <p className="font-semibold">Something went wrong</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This page hit an unexpected error. Try again — if it keeps
              happening, let support know.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              variant="outline"
              className="border-white/[0.08]"
              onClick={() => reset()}
            >
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
            <Link href="/home" className={buttonVariants({ variant: "ghost" })}>
              <Home className="h-4 w-4" />
              Go home
            </Link>
          </div>
          {error.digest ? (
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50">
              Error {error.digest}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
