"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2, Circle, ChevronDown, ChevronUp, EyeOff, Loader2, Heart, Plus, Settings, Video as VideoIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { DateNavigator } from "@/components/crossfit/date-navigator";
import { useGymContext, useActiveMembership } from "@/hooks/useGymContext";
import {
  useRecoveryToday,
  useStartRecoverySession,
  useUpdateRecoverySession,
  type RecoveryTodayEntry,
} from "@/hooks/useRecoverySessions";
import {
  useDismissedAssignments,
  useUpdateMyOverride,
  type DismissedAssignment,
} from "@/hooks/useRecoverySchedules";
import { formatPrescription, type RecoveryVideo } from "@/types/recovery";
import { SessionMovementDetail } from "@/components/recovery/session-movement-detail";
import { useStickyTab } from "@/hooks/useStickyTab";

function toDateString(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function RecoveryTodayPage() {
  const [date, setDate] = useState<Date>(new Date());
  const dateStr = toDateString(date);
  const activeMembership = useActiveMembership();
  // Persist the user's pick across refreshes. Until they choose (or on a
  // fresh device), fall back to the gym-context default so a late-resolving
  // membership flips from "personal" to "gym".
  const [preferOverride, setPreferOverride] = useStickyTab<"personal" | "gym">("recovery");
  const prefer = preferOverride ?? (activeMembership ? "gym" : "personal");

  const { data: todays, isLoading } = useRecoveryToday(dateStr, prefer);

  const entries = todays ?? [];

  return (
    <div className="flex flex-col gap-4">
      <DateNavigator selectedDate={date} onDateChange={setDate} />

      {activeMembership && (
        <div className="flex gap-1 rounded-lg bg-muted/30 p-1">
          <Button
            size="sm"
            variant={prefer === "gym" ? "default" : "ghost"}
            className="flex-1"
            onClick={() => setPreferOverride("gym")}
          >
            Gym
          </Button>
          <Button
            size="sm"
            variant={prefer === "personal" ? "default" : "ghost"}
            className="flex-1"
            onClick={() => setPreferOverride("personal")}
          >
            Personal
          </Button>
        </div>
      )}

      <HiddenAssignmentsButton />

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : entries.length === 0 ? (
        <EmptyState />
      ) : (
        entries.map((entry) =>
          entry.schedule ? (
            <ScheduleSection
              key={entry.schedule.id}
              entry={entry}
              dateStr={dateStr}
              prefer={prefer}
            />
          ) : null
        )
      )}

      <ManageLink />
    </div>
  );
}

function ScheduleSection({
  entry,
  dateStr,
  prefer,
}: {
  entry: RecoveryTodayEntry;
  dateStr: string;
  prefer: "personal" | "gym";
}) {
  const startSession = useStartRecoverySession();
  const updateSession = useUpdateRecoverySession();

  const sessionItems = useMemo(() => entry.session?.items ?? [], [entry.session?.items]);
  const sessionId = entry.session?.id ?? null;
  const sessionStatus = entry.session?.status ?? null;
  const completed = sessionItems.filter((i) => i.status === "done").length;
  const totalItems = sessionItems.length;

  // Editing a schedule deletes + re-inserts its slots; the FK on
  // recovery_session_items.schedule_slot_id is ON DELETE SET NULL, so older
  // in-progress sessions end up with null scheduleSlotIds. Match on
  // (slotId, movementId) when available, fall back to movementId so those
  // sessions still hydrate their videos/description.
  const itemByPair = useMemo(() => {
    const byPair = new Map<string, typeof sessionItems[number]>();
    const byMovement = new Map<string, typeof sessionItems[number]>();
    for (const it of sessionItems) {
      if (it.scheduleSlotId) {
        byPair.set(`${it.scheduleSlotId}::${it.movementId}`, it);
      }
      if (!byMovement.has(it.movementId)) byMovement.set(it.movementId, it);
    }
    return {
      get(slotId: string, movementId: string) {
        return (
          byPair.get(`${slotId}::${movementId}`) ?? byMovement.get(movementId)
        );
      },
    };
  }, [sessionItems]);

  const handleStart = () => {
    if (!entry.schedule) return;
    startSession.mutate(
      { date: dateStr, prefer, scheduleId: entry.schedule.id },
      { onError: (e) => toast.error(e.message) }
    );
  };

  const toggleItem = (itemId: string, currentStatus: string) => {
    if (!sessionId) return;
    const next = currentStatus === "done" ? "pending" : "done";
    updateSession.mutate({
      id: sessionId,
      items: [{ id: itemId, status: next }],
    });
  };

  const skipItem = (itemId: string) => {
    if (!sessionId) return;
    updateSession.mutate({
      id: sessionId,
      items: [{ id: itemId, status: "skipped" }],
    });
  };

  const finishSession = () => {
    if (!sessionId) return;
    updateSession.mutate(
      { id: sessionId, status: "complete" },
      {
        onSuccess: () => toast.success("Session complete"),
        onError: (e) => toast.error(e.message),
      }
    );
  };

  if (!entry.schedule) return null;

  return (
    <div className="flex flex-col gap-2">
      <Card>
        <CardContent className="py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate">{entry.schedule.name}</p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge variant="outline" className="text-[10px]">
                  {entry.schedule.kind === "day_keyed" ? "Day-keyed" : "Frequency"}
                </Badge>
                {entry.schedule.kind === "day_keyed" && entry.dayIndex && (
                  <Badge variant="secondary" className="text-[10px]">
                    Day {entry.dayIndex} / {entry.schedule.rotationDays}
                  </Badge>
                )}
                {entry.schedule.kind === "frequency_keyed" && (
                  <Badge variant="secondary" className="text-[10px]">
                    {entry.weeklyCompleted} / {entry.schedule.weeklyTarget ?? "—"} this week
                  </Badge>
                )}
                {entry.durationLabel && (
                  <span className="text-[10px] text-muted-foreground">
                    {entry.durationLabel}
                  </span>
                )}
                {sessionStatus === "in_progress" && (
                  <Badge className="text-[10px] bg-amber-500/15 text-amber-300 border-amber-500/30">
                    In Progress
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {entry.slots.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          No movements scheduled for {entry.schedule.kind === "day_keyed" ? `Day ${entry.dayIndex}` : "today"}.
        </p>
      ) : !sessionId ? (
        <Button onClick={handleStart} disabled={startSession.isPending}>
          {startSession.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Plus className="h-4 w-4 mr-2" />
          )}
          Start session
        </Button>
      ) : (
        <>
          {entry.slots.map((slot) => {
            if (slot.routineId && slot.routineMovements.length > 0) {
              return (
                <RoutineCard
                  key={slot.slotId}
                  slot={slot}
                  itemByPair={itemByPair}
                  onToggle={toggleItem}
                  onSkip={skipItem}
                />
              );
            }
            const item = slot.movementId
              ? itemByPair.get(slot.slotId, slot.movementId)
              : undefined;
            return (
              <MovementRow
                key={slot.slotId}
                name={slot.movementName ?? "Movement"}
                prescription={slot.prescription}
                notes={slot.notes}
                isPerSide={slot.isPerSide}
                item={item}
                onToggle={toggleItem}
                onSkip={skipItem}
              />
            );
          })}

          {sessionStatus !== "complete" && (
            <Button onClick={finishSession} className="mt-2">
              Mark Complete ({completed}/{totalItems})
            </Button>
          )}
          {sessionStatus === "complete" && (
            <p className="text-sm text-center text-emerald-500">
              ✓ Session complete
            </p>
          )}
        </>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <Card className="gradient-border overflow-visible">
      <CardContent className="flex flex-col items-center gap-3 py-10 bg-mesh rounded-xl text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/10">
          <Heart className="h-5 w-5 text-rose-400" />
        </div>
        <p className="text-sm text-muted-foreground max-w-xs">
          No recovery schedule active for this date. Browse the library or build your own.
        </p>
        <div className="flex gap-2">
          <Link
            href="/recovery/movements"
            className="inline-flex items-center rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            Browse library
          </Link>
          <Link
            href="/recovery/schedules/new"
            className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Build a schedule
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function ManageLink() {
  const { data: ctx } = useGymContext();
  const isSuper = !!ctx?.user.isSuperAdmin;
  if (!isSuper) return null;
  return (
    <Link
      href="/admin/recovery-movements"
      className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/[0.05] px-3 py-2.5 text-xs font-medium text-primary hover:bg-primary/[0.1]"
    >
      <span className="flex items-center gap-2">
        <Settings className="h-3.5 w-3.5" />
        Manage recovery movements
      </span>
    </Link>
  );
}

interface SessionItemLite {
  id: string;
  status: string;
  movementId: string;
  scheduleSlotId: string | null;
  description?: string | null;
  videos?: RecoveryVideo[];
}

function MovementRow(props: {
  name: string;
  prescription: Record<string, unknown>;
  notes: string | null;
  isPerSide: boolean;
  item?: SessionItemLite;
  onToggle: (itemId: string, status: string) => void;
  onSkip: (itemId: string) => void;
}) {
  const { name, prescription, notes, isPerSide, item, onToggle, onSkip } = props;
  const status = item?.status ?? "pending";
  const checked = status === "done";
  const skipped = status === "skipped";
  const [expanded, setExpanded] = useState(false);
  const videos = item?.videos ?? [];
  const description = item?.description ?? null;
  const hasDetail = !!description || videos.length > 0;

  return (
    <Card className={skipped ? "opacity-50" : ""}>
      <CardContent className="py-3">
        <div className="flex items-start gap-3">
          <button
            onClick={() => item && onToggle(item.id, status)}
            className="mt-0.5"
            disabled={!item}
          >
            {checked ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            ) : (
              <Circle className="h-5 w-5 text-muted-foreground" />
            )}
          </button>
          <button
            type="button"
            onClick={() => hasDetail && setExpanded((v) => !v)}
            className="flex-1 min-w-0 text-left"
            disabled={!hasDetail}
          >
            <div className="flex items-center gap-2">
              <p className={`text-sm font-medium truncate ${checked ? "line-through text-muted-foreground" : ""}`}>
                {name}
              </p>
              {videos.length > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                  <VideoIcon className="h-3 w-3" />
                  {videos.length}
                </span>
              )}
              {hasDetail && (
                expanded ? (
                  <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {formatPrescription(prescription, isPerSide) || "—"}
            </p>
            {notes && (
              <p className="text-[11px] text-muted-foreground italic mt-1">{notes}</p>
            )}
          </button>
          {item && !skipped && !checked && (
            <button
              onClick={() => onSkip(item.id)}
              className="text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground shrink-0"
            >
              Skip
            </button>
          )}
          {skipped && (
            <Badge variant="outline" className="text-[10px]">
              Skipped
            </Badge>
          )}
        </div>
        {expanded && item && (
          <div className="mt-3 border-t border-white/[0.06] pt-3">
            <SessionMovementDetail
              movementId={item.movementId}
              description={description}
              videos={videos}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RoutineCard(props: {
  slot: {
    slotId: string;
    routineName: string | null;
    routineMovements: Array<{
      id: string;
      movementId: string;
      movementName: string;
      isPerSide: boolean;
      prescription: Record<string, unknown>;
    }>;
    notes: string | null;
  };
  itemByPair: { get: (slotId: string, movementId: string) => SessionItemLite | undefined };
  onToggle: (itemId: string, status: string) => void;
  onSkip: (itemId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const items = props.slot.routineMovements.map((m) => ({
    rm: m,
    item: props.itemByPair.get(props.slot.slotId, m.movementId),
  }));
  const done = items.filter((i) => i.item?.status === "done").length;
  const total = items.length;

  return (
    <Card>
      <CardContent className="py-3">
        <button
          className="flex items-center w-full gap-2"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex-1 text-left">
            <p className="text-sm font-medium">{props.slot.routineName ?? "Routine"}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {total} movement{total === 1 ? "" : "s"}
            </p>
          </div>
          <Badge variant={done === total ? "default" : "secondary"}>
            {done}/{total}
          </Badge>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        {expanded && (
          <div className="mt-3 space-y-2 border-t border-white/[0.06] pt-3">
            {items.map(({ rm, item }) => (
              <RoutineChildRow
                key={rm.id}
                movementName={rm.movementName}
                prescription={rm.prescription}
                isPerSide={rm.isPerSide}
                item={item}
                onToggle={props.onToggle}
                onSkip={props.onSkip}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RoutineChildRow(props: {
  movementName: string;
  prescription: Record<string, unknown>;
  isPerSide: boolean;
  item?: SessionItemLite;
  onToggle: (itemId: string, status: string) => void;
  onSkip: (itemId: string) => void;
}) {
  const { movementName, prescription, isPerSide, item, onToggle, onSkip } = props;
  const status = item?.status ?? "pending";
  const checked = status === "done";
  const skipped = status === "skipped";
  const [expanded, setExpanded] = useState(false);
  const videos = item?.videos ?? [];
  const description = item?.description ?? null;
  const hasDetail = !!description || videos.length > 0;

  return (
    <div className={skipped ? "opacity-50" : ""}>
      <div className="flex items-start gap-3">
        <button
          onClick={() => item && onToggle(item.id, status)}
          className="mt-0.5"
          disabled={!item}
        >
          {checked ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          ) : (
            <Circle className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        <button
          type="button"
          onClick={() => hasDetail && setExpanded((v) => !v)}
          className="flex-1 min-w-0 text-left"
          disabled={!hasDetail}
        >
          <div className="flex items-center gap-2">
            <p className={`text-sm truncate ${checked ? "line-through text-muted-foreground" : ""}`}>
              {movementName}
            </p>
            {videos.length > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                <VideoIcon className="h-3 w-3" />
                {videos.length}
              </span>
            )}
            {hasDetail && (
              expanded ? (
                <ChevronUp className="h-3 w-3 text-muted-foreground shrink-0" />
              ) : (
                <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
              )
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {formatPrescription(prescription, isPerSide) || "—"}
          </p>
        </button>
        {item && !skipped && !checked && (
          <button
            onClick={() => onSkip(item.id)}
            className="text-[10px] uppercase text-muted-foreground hover:text-foreground shrink-0"
          >
            Skip
          </button>
        )}
      </div>
      {/* Expanded detail spans the full row width (not indented under the
          checkbox) so the inline video can break out to the card edges. */}
      {expanded && item && (
        <div className="mt-2">
          <SessionMovementDetail
            movementId={item.movementId}
            description={description}
            videos={videos}
          />
        </div>
      )}
    </div>
  );
}

function HiddenAssignmentsButton() {
  const [open, setOpen] = useState(false);
  const { data: dismissed = [], isLoading } = useDismissedAssignments();
  if (isLoading || dismissed.length === 0) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <button className="flex items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-xs text-muted-foreground hover:bg-accent/50">
            <span className="flex items-center gap-1.5">
              <EyeOff className="h-3.5 w-3.5" />
              Hidden assignments
            </span>
            <Badge variant="secondary" className="text-[10px]">
              {dismissed.length}
            </Badge>
          </button>
        }
      />
      <SheetContent side="bottom" className="max-h-[80dvh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Hidden assignments</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-2 px-4 pb-6">
          {dismissed.map((d) => (
            <DismissedRow key={d.assignmentId} dismissed={d} />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DismissedRow({ dismissed }: { dismissed: DismissedAssignment }) {
  const update = useUpdateMyOverride();
  const unhide = () => {
    update.mutate(
      { assignmentId: dismissed.assignmentId, isDismissed: false },
      {
        onSuccess: () => toast.success("Assignment restored"),
        onError: (e) => toast.error(e.message),
      }
    );
  };
  return (
    <Card>
      <CardContent className="py-3 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">
            {dismissed.scheduleName ?? "Recovery schedule"}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {dismissed.isGymWide
              ? `${dismissed.communityName ?? "Gym"} · all members`
              : "Direct assignment"}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {dismissed.startsOn}
            {dismissed.endsOn ? ` → ${dismissed.endsOn}` : " → ongoing"}
            {dismissed.durationLabel ? ` · ${dismissed.durationLabel}` : ""}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={unhide}
          disabled={update.isPending}
        >
          {update.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
          Un-hide
        </Button>
      </CardContent>
    </Card>
  );
}
