"use client";

// Member-facing class detail page. Shows description, coach, and the
// roster of registered athletes. Coaches/admins see full names + statuses;
// members see first names + avatars only (privacy per spec §2.2).

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/shared/back-button";
import {
  useClassDetail,
  useRegisterForClassDetail,
  useUnregisterFromClassDetail,
} from "@/hooks/useClasses";

export default function ClassDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data, isLoading, error } = useClassDetail(id);
  const register = useRegisterForClassDetail(id);
  const unregister = useUnregisterFromClassDetail(id);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (error || !data) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10">
          <p className="text-sm text-muted-foreground">Class not found.</p>
          <Link
            href="/classes"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ArrowLeft className="size-4" />
            Back to classes
          </Link>
        </CardContent>
      </Card>
    );
  }

  const { instance, isManager, roster } = data;
  const start = new Date(instance.startAt);
  const end = new Date(instance.endAt);
  const dateLabel = start.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const timeLabel = `${start.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })} – ${end.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })}`;

  const isCancelled = instance.status === "cancelled";
  const registeredCount = roster.filter(
    (r) => r.status === "registered" || r.status === "attended"
  ).length;
  const isRegistered =
    instance.myStatus === "registered" || instance.myStatus === "attended";

  return (
    <div className="flex flex-col gap-4">
      <BackButton fallbackHref="/classes" label="Classes" />

      {instance.kind === "event" && instance.eventImageUrl ? (
        <img
          src={instance.eventImageUrl}
          alt={instance.name}
          className="h-40 w-full rounded-xl object-cover"
        />
      ) : null}

      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                {instance.kind === "event" ? <Badge>Event</Badge> : null}
                {isCancelled ? (
                  <Badge variant="destructive">Cancelled</Badge>
                ) : null}
              </div>
              <h1 className="text-xl font-bold leading-tight">
                {instance.name}
              </h1>
              <p className="text-xs text-muted-foreground">
                {dateLabel} · {timeLabel}
              </p>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              {registeredCount}/{instance.capacity}
              <div>registered</div>
            </div>
          </div>

          {instance.description ? (
            <p className="whitespace-pre-line text-sm text-muted-foreground">
              {instance.description}
            </p>
          ) : null}

          {isCancelled && instance.cancellationReason ? (
            <p className="text-xs text-destructive">
              Reason: {instance.cancellationReason}
            </p>
          ) : null}

          {isCancelled ? null : isRegistered ? (
            <Button
              variant="outline"
              className="w-full"
              disabled={unregister.isPending}
              onClick={() => unregister.mutate()}
            >
              Cancel registration
            </Button>
          ) : (
            <Button
              className="w-full"
              disabled={register.isPending}
              onClick={() => register.mutate()}
            >
              {register.isPending ? "Registering…" : "Register"}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 py-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Coach
          </p>
          {instance.coachName ? (
            <div className="flex items-center gap-3">
              {instance.coachImage ? (
                <img
                  src={instance.coachImage}
                  alt={instance.coachName}
                  className="size-10 rounded-full object-cover"
                />
              ) : (
                <div className="flex size-10 items-center justify-center rounded-full bg-muted text-sm font-medium">
                  {instance.coachName.slice(0, 1)}
                </div>
              )}
              <p className="text-sm font-medium">{instance.coachName}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No coach assigned yet.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Who&apos;s registered
            </p>
            <p className="text-xs text-muted-foreground">
              {registeredCount}
              {registeredCount === 1 ? " athlete" : " athletes"}
            </p>
          </div>
          {roster.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No one has registered yet. Be the first!
            </p>
          ) : (
            <ul className="divide-y">
              {roster.map((r) => (
                <li
                  key={r.registrationId}
                  className="flex items-center gap-3 py-2"
                >
                  {r.userImage ? (
                    <img
                      src={r.userImage}
                      alt={r.userName}
                      className="size-9 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex size-9 items-center justify-center rounded-full bg-muted text-xs font-medium">
                      {r.userName.slice(0, 1)}
                    </div>
                  )}
                  <p className="flex-1 truncate text-sm">{r.userName}</p>
                  {isManager ? (
                    <Badge
                      variant={
                        r.status === "attended"
                          ? "default"
                          : r.status === "cancelled" || r.status === "no_show"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {r.status}
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

