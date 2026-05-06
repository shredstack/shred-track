"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Users, Trash2 } from "lucide-react";
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
import { toast } from "sonner";

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
  const [userId, setUserId] = useState("");
  const [startsOn, setStartsOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [endsOn, setEndsOn] = useState("");
  const [durationLabel, setDurationLabel] = useState("");

  const submit = async () => {
    try {
      await create.mutateAsync({
        scheduleId: id,
        userId: forAllMembers ? null : userId.trim() || null,
        communityId: forAllMembers ? schedule?.communityId ?? null : null,
        startsOn,
        endsOn: endsOn || null,
        durationLabel: durationLabel || null,
      });
      toast.success("Assigned");
      setUserId("");
      setEndsOn("");
      setDurationLabel("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/recovery/schedules/${id}`}
        className="inline-flex items-center text-xs text-muted-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5 mr-1" />
        Back
      </Link>

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
                  <Label className="text-xs">Athlete user ID</Label>
                  <Input
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                    placeholder="UUID"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Athlete picker is coming soon — paste the user UUID for now.
                  </p>
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
            assignments.map((a) => (
              <Card key={a.id}>
                <CardContent className="py-3 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">
                      {a.userId ? `User ${a.userId.slice(0, 8)}…` : "All members"}
                    </p>
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
            ))
          )}
        </>
      )}
    </div>
  );
}
