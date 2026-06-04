"use client";

import { use, useMemo, useState } from "react";
import { Check, Loader2, Search, Trash2, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  useRecoverySchedule,
  useRecoveryAssignments,
  useCreateAssignment,
  useDeleteAssignment,
} from "@/hooks/useRecoverySchedules";
import { useGymMembers, type GymMemberRow } from "@/hooks/useGymMembers";
import { toast } from "sonner";
import { BackButton } from "@/components/shared/back-button";

export default function AssignSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: schedule } = useRecoverySchedule(id);
  const { data: assignments } = useRecoveryAssignments(id);
  const create = useCreateAssignment();
  const remove = useDeleteAssignment();

  const [forAllMembers, setForAllMembers] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [startsOn, setStartsOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [endsOn, setEndsOn] = useState("");
  const [durationLabel, setDurationLabel] = useState("");

  const { data: members } = useGymMembers(schedule?.communityId ?? null);
  const memberById = useMemo(() => {
    const map = new Map<string, GymMemberRow>();
    for (const m of members ?? []) map.set(m.userId, m);
    return map;
  }, [members]);
  const selectedMember = userId ? memberById.get(userId) ?? null : null;

  const submit = async () => {
    if (!forAllMembers && !userId) {
      toast.error("Pick an athlete");
      return;
    }
    try {
      await create.mutateAsync({
        scheduleId: id,
        userId: forAllMembers ? null : userId,
        communityId: forAllMembers ? schedule?.communityId ?? null : null,
        startsOn,
        endsOn: endsOn || null,
        durationLabel: durationLabel || null,
      });
      toast.success("Assigned");
      setUserId(null);
      setEndsOn("");
      setDurationLabel("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <BackButton fallbackHref={`/recovery/schedules/${id}`} label="Schedule" />

      <h1 className="text-lg font-semibold flex items-center gap-2">
        <Users className="h-4 w-4" />
        Assign schedule
      </h1>

      {!schedule?.communityId ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Only gym schedules can be assigned. Switch your scope to a gym to assign this schedule to athletes.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="py-3 space-y-3">
              <div>
                <Label className="text-xs">Target</Label>
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={() => setForAllMembers(true)}
                    className={`flex-1 rounded-md border px-3 py-2 text-sm ${forAllMembers ? "border-primary bg-primary/10 text-primary" : "border-input"}`}
                  >
                    All gym members
                  </button>
                  <button
                    onClick={() => setForAllMembers(false)}
                    className={`flex-1 rounded-md border px-3 py-2 text-sm ${!forAllMembers ? "border-primary bg-primary/10 text-primary" : "border-input"}`}
                  >
                    Single athlete
                  </button>
                </div>
              </div>
              {!forAllMembers && (
                <div>
                  <Label className="text-xs">Athlete</Label>
                  <AthletePicker
                    members={members ?? []}
                    selected={selectedMember}
                    onSelect={(m) => setUserId(m.userId)}
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Starts on</Label>
                  <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Ends on (optional)</Label>
                  <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Duration label (optional)</Label>
                <Input
                  value={durationLabel}
                  onChange={(e) => setDurationLabel(e.target.value)}
                  placeholder='e.g. "2 months"'
                />
              </div>
              <Button onClick={submit} disabled={create.isPending} className="w-full">
                {create.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                Assign
              </Button>
            </CardContent>
          </Card>

          <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Existing
          </h2>
          {(!assignments || assignments.length === 0) ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No assignments yet.
            </p>
          ) : (
            assignments.map((a) => {
              const m = a.userId ? memberById.get(a.userId) : null;
              const targetLabel = a.userId
                ? m
                  ? `${m.name || m.email}`
                  : `User ${a.userId.slice(0, 8)}…`
                : "All members";
              return (
              <Card key={a.id}>
                <CardContent className="py-3 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{targetLabel}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {a.startsOn}
                      {a.endsOn ? ` → ${a.endsOn}` : " → ongoing"}
                    </p>
                    {a.durationLabel && (
                      <Badge variant="outline" className="text-[10px] mt-1">
                        {a.durationLabel}
                      </Badge>
                    )}
                  </div>
                  <button
                    onClick={() =>
                      remove.mutate({ scheduleId: id, assignmentId: a.id })
                    }
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </CardContent>
              </Card>
              );
            })
          )}
        </>
      )}
    </div>
  );
}

function AthletePicker({
  members,
  selected,
  onSelect,
}: {
  members: GymMemberRow[];
  selected: GymMemberRow | null;
  onSelect: (m: GymMemberRow) => void;
}) {
  const [search, setSearch] = useState("");

  // Active members only — assigning a recovery schedule to a deactivated
  // member would surface in their today view if they ever rejoined, but
  // the common case is an in-good-standing athlete.
  const active = useMemo(
    () => members.filter((m) => m.isActive),
    [members]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return active;
    return active.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q)
    );
  }, [active, search]);

  return (
    <div className="space-y-1.5">
      {selected && (
        <div className="flex items-center justify-between rounded-md border border-primary bg-primary/5 px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">
              {selected.name || selected.email}
            </p>
            {selected.name && (
              <p className="text-[11px] text-muted-foreground truncate">
                {selected.email}
              </p>
            )}
          </div>
          <Check className="h-4 w-4 text-primary shrink-0" />
        </div>
      )}
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email…"
          className="pl-9"
        />
      </div>
      {active.length === 0 ? (
        <p className="text-[11px] text-muted-foreground py-2">
          No active members in this gym.
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-[11px] text-muted-foreground py-2">
          No athletes match your search.
        </p>
      ) : (
        <div className="max-h-56 overflow-y-auto rounded-md border border-input">
          {filtered.map((m) => {
            const isSelected = selected?.userId === m.userId;
            return (
              <button
                key={m.userId}
                type="button"
                onClick={() => onSelect(m)}
                className={`w-full flex items-center justify-between px-3 py-2 text-left text-sm border-b border-input last:border-0 ${
                  isSelected ? "bg-primary/10" : "hover:bg-accent/50"
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate">{m.name || m.email}</p>
                  {m.name && (
                    <p className="text-[11px] text-muted-foreground truncate">
                      {m.email}
                    </p>
                  )}
                </div>
                {(m.isAdmin || m.isCoach) && (
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {m.isAdmin ? "admin" : "coach"}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
