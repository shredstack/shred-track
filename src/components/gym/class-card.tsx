"use client";

// Shared class card used by the date-based class calendar (member + coach
// views) and the member "upcoming events" banner. `ClassCard` is the
// presentational shell — coach name/avatar, description, capacity — and the
// `MemberClassCard` / `CoachClassCard` wrappers layer mode-specific actions
// (register/cancel vs. roster/cancel/coach-picker) on top of it.

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CoachPicker } from "@/components/gym/coach-picker";
import { cn } from "@/lib/utils";
import {
  useRegisterForClass,
  useUnregisterFromClass,
  type ClassInstanceListItem,
  type CoachOption,
} from "@/hooks/useClasses";

function formatWhen(startAt: string, endAt: string, showDate: boolean) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const timeOpts: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
  };
  const time = `${start.toLocaleTimeString("en-US", timeOpts)} – ${end.toLocaleTimeString("en-US", timeOpts)}`;
  if (!showDate) return time;
  const date = start.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `${date} · ${time}`;
}

interface ClassCardProps {
  instance: ClassInstanceListItem;
  /** Buttons rendered to the right of the capacity line. */
  actions?: React.ReactNode;
  /** Full-width action row below the capacity line (e.g. the coach picker). */
  secondaryActions?: React.ReactNode;
  /** Adds the hover affordance when the card is wrapped in a link. */
  interactive?: boolean;
  /** Prefix the time with the weekday/date — used by the events banner. */
  showDate?: boolean;
}

/** Presentational class card. Wrap in a link / supply `actions` via a wrapper. */
export function ClassCard({
  instance,
  actions,
  secondaryActions,
  interactive,
  showDate = false,
}: ClassCardProps) {
  const isEvent = instance.kind === "event";
  const isCancelled = instance.status === "cancelled";
  const isRegistered =
    instance.myStatus === "registered" || instance.myStatus === "attended";
  const isFull = instance.registeredCount >= instance.capacity;

  return (
    <Card
      className={cn(
        "overflow-hidden",
        interactive && "transition-colors hover:bg-accent/30",
        isCancelled && "opacity-70"
      )}
    >
      {isEvent && instance.eventImageUrl ? (
        <img
          src={instance.eventImageUrl}
          alt={instance.name}
          className="h-32 w-full object-cover"
        />
      ) : null}
      <CardContent className="space-y-3 py-3">
        {/* Title + time + badges */}
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {isEvent ? <Badge>Event</Badge> : null}
            {isCancelled ? <Badge variant="destructive">Cancelled</Badge> : null}
            {isRegistered && !isCancelled ? (
              <Badge variant="secondary">Registered</Badge>
            ) : null}
            <span className="text-xs font-medium text-muted-foreground">
              {formatWhen(instance.startAt, instance.endAt, showDate)}
            </span>
          </div>
          <p className="text-base font-semibold leading-tight">
            {instance.name}
          </p>
        </div>

        {/* Coach */}
        <div className="flex items-center gap-2">
          <Avatar size="sm">
            {instance.coachImage ? (
              <AvatarImage
                src={instance.coachImage}
                alt={instance.coachName ?? "Coach"}
              />
            ) : null}
            <AvatarFallback>
              {instance.coachName
                ? instance.coachName.slice(0, 1).toUpperCase()
                : "?"}
            </AvatarFallback>
          </Avatar>
          <span className="text-xs text-muted-foreground">
            {instance.coachName ?? "No coach assigned"}
          </span>
        </div>

        {/* Description */}
        {instance.description ? (
          <p className="line-clamp-3 whitespace-pre-line text-xs text-muted-foreground">
            {instance.description}
          </p>
        ) : null}

        {/* Capacity + actions */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            {instance.registeredCount}/{instance.capacity} registered
            {isFull && !isCancelled ? " · Full" : ""}
          </span>
          {actions}
        </div>
        {secondaryActions}
      </CardContent>
    </Card>
  );
}

// Stop a card-level link from navigating when an inline action is tapped.
function stopNav(e: React.MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
}

interface MemberClassCardProps {
  instance: ClassInstanceListItem;
  communityId: string;
  showDate?: boolean;
}

/** Member view: tap to open the detail page, register/cancel inline. */
export function MemberClassCard({
  instance,
  communityId,
  showDate,
}: MemberClassCardProps) {
  const register = useRegisterForClass(communityId);
  const unregister = useUnregisterFromClass(communityId);

  const isCancelled = instance.status === "cancelled";
  const isRegistered =
    instance.myStatus === "registered" || instance.myStatus === "attended";
  const isFull = instance.registeredCount >= instance.capacity;

  let actions: React.ReactNode = null;
  if (!isCancelled) {
    if (isRegistered) {
      actions = (
        <Button
          size="sm"
          variant="outline"
          disabled={unregister.isPending}
          onClick={(e) => {
            stopNav(e);
            unregister.mutate(instance.id);
          }}
        >
          Cancel
        </Button>
      );
    } else if (isFull) {
      actions = (
        <Button size="sm" variant="outline" disabled>
          Full
        </Button>
      );
    } else {
      actions = (
        <Button
          size="sm"
          disabled={register.isPending}
          onClick={(e) => {
            stopNav(e);
            register.mutate(instance.id);
          }}
        >
          Register
        </Button>
      );
    }
  }

  return (
    <Link
      href={`/classes/${instance.id}`}
      id={`class-${instance.id}`}
      className="block"
    >
      <ClassCard
        instance={instance}
        interactive
        showDate={showDate}
        actions={actions}
      />
    </Link>
  );
}

interface CoachClassCardProps {
  instance: ClassInstanceListItem;
  communityId: string;
  coaches: CoachOption[];
}

/** Coach view: view the roster, cancel the class, reassign the coach. */
export function CoachClassCard({
  instance,
  communityId,
  coaches,
}: CoachClassCardProps) {
  const qc = useQueryClient();
  // Prefix match — refreshes whichever day window the calendar is showing.
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["gym", communityId, "classes"] });

  const cancel = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/classes/${instance.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      if (!res.ok) throw new Error("Failed to cancel class");
    },
    onSuccess: invalidate,
  });

  const setCoach = useMutation({
    mutationFn: async (coachId: string | null) => {
      const res = await fetch(`/api/classes/${instance.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "edit-coach", coachId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to set coach");
      }
    },
    onSuccess: invalidate,
  });

  const isCancelled = instance.status === "cancelled";

  const actions = (
    <div className="flex items-center gap-2">
      <Link
        href={`/gym/classes/${instance.id}`}
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        Roster
      </Link>
      {!isCancelled ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={cancel.isPending}
          onClick={() => {
            if (confirm("Cancel this class?")) cancel.mutate();
          }}
        >
          Cancel
        </Button>
      ) : null}
    </div>
  );

  const secondaryActions =
    !isCancelled && instance.kind === "class" ? (
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Coach
        </span>
        <CoachPicker
          coaches={coaches}
          value={instance.coachId}
          fallbackLabel={instance.coachName ?? undefined}
          onChange={(coachId) => setCoach.mutate(coachId)}
          disabled={setCoach.isPending}
          size="sm"
          className="flex-1 text-xs"
        />
      </div>
    ) : null;

  return (
    <ClassCard
      instance={instance}
      actions={actions}
      secondaryActions={secondaryActions}
    />
  );
}
