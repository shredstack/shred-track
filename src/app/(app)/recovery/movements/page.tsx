"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Search, Loader2, Plus, Video, ChevronRight, Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  useRecoveryMovements,
  useCreateRecoveryMovement,
} from "@/hooks/useRecoveryMovements";
import {
  RECOVERY_CATEGORIES,
  RECOVERY_BODY_REGIONS,
  RECOVERY_BODY_REGION_FILTER_OPTIONS,
  type RecoveryCategory,
  type RecoveryBodyRegion,
  type RecoveryBodyRegionFilter,
} from "@/types/recovery";
import { CategoryPills } from "@/components/shared/category-pills";

export default function RecoveryMovementsPage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<RecoveryCategory | "all">("all");
  const [bodyRegion, setBodyRegion] = useState<RecoveryBodyRegionFilter>("all");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: movements, isLoading } = useRecoveryMovements({
    q: search || undefined,
    category: category === "all" ? undefined : category,
    bodyRegion: bodyRegion === "all" ? undefined : bodyRegion,
    pendingOnly,
    mineOnly,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search movements..."
            className="pl-9"
          />
        </div>

        <CategoryPills
          value={bodyRegion}
          onChange={setBodyRegion}
          options={RECOVERY_BODY_REGION_FILTER_OPTIONS}
          ariaLabel="Filter by body region"
          className="-mx-1 px-1"
        />
        <div className="flex flex-wrap gap-2 text-xs">
          <select
            className="rounded-md border border-input bg-background px-2 py-1"
            value={category}
            onChange={(e) => setCategory(e.target.value as RecoveryCategory | "all")}
          >
            <option value="all">All categories</option>
            {RECOVERY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            onClick={() => setMineOnly((v) => !v)}
            className={`rounded-md border px-2 py-1 ${mineOnly ? "border-primary bg-primary/10 text-primary" : "border-input"}`}
          >
            Mine only
          </button>
          <button
            onClick={() => setPendingOnly((v) => !v)}
            className={`rounded-md border px-2 py-1 ${pendingOnly ? "border-primary bg-primary/10 text-primary" : "border-input"}`}
          >
            Pending
          </button>
        </div>
      </div>

      <Button onClick={() => setCreateOpen(true)} variant="outline" size="sm">
        <Plus className="h-3.5 w-3.5 mr-1" />
        Add movement
      </Button>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : !movements || movements.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm text-muted-foreground">No movements match your filters.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{movements.length} movements</p>
          {movements.map((m) => (
            <Link key={m.id} href={`/recovery/movements/${m.id}`}>
              <Card className="hover:bg-muted/30 transition-colors">
                <CardContent className="flex items-center gap-3 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">
                        {m.canonicalName}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {m.category}
                      </Badge>
                      {!m.isValidated && m.isOwnSubmission && (
                        <Badge variant="secondary" className="text-[10px]">
                          <Clock className="h-3 w-3 mr-0.5" />
                          Pending
                        </Badge>
                      )}
                      {(m.videoCount ?? 0) > 0 && (
                        <span className="flex items-center text-[10px] text-muted-foreground">
                          <Video className="h-3 w-3 mr-0.5" />
                          {m.videoCount}
                        </span>
                      )}
                    </div>
                    {m.bodyRegion && m.bodyRegion.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {m.bodyRegion.slice(0, 3).map((r) => (
                          <span
                            key={r}
                            className="text-[10px] text-muted-foreground"
                          >
                            #{r.replace(/_/g, " ")}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <CreateDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<RecoveryCategory>("stretch");
  const [description, setDescription] = useState("");
  const [isPerSide, setIsPerSide] = useState(false);
  const [bodyRegions, setBodyRegions] = useState<RecoveryBodyRegion[]>([]);
  const [sets, setSets] = useState<string>("");
  const [reps, setReps] = useState<string>("");
  const [duration, setDuration] = useState<string>("");
  const create = useCreateRecoveryMovement();

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Name required");
      return;
    }
    const defaultPrescription: Record<string, unknown> = {};
    if (sets) defaultPrescription.sets = Number(sets);
    if (reps) defaultPrescription.reps = Number(reps);
    if (duration) defaultPrescription.durationSeconds = Number(duration);
    if (isPerSide) defaultPrescription.perSide = true;

    try {
      await create.mutateAsync({
        canonicalName: name.trim(),
        category,
        bodyRegion: bodyRegions,
        description: description || undefined,
        isPerSide,
        defaultPrescription,
      });
      toast.success("Movement added");
      setName("");
      setDescription("");
      setSets("");
      setReps("");
      setDuration("");
      setBodyRegions([]);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      toast.error(msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a movement</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 90/90 hip switch" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Category</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={category}
              onChange={(e) => setCategory(e.target.value as RecoveryCategory)}
            >
              {RECOVERY_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Body regions</Label>
            <div className="flex flex-wrap gap-1">
              {RECOVERY_BODY_REGIONS.map((r) => {
                const on = bodyRegions.includes(r);
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => {
                      setBodyRegions(
                        on ? bodyRegions.filter((x) => x !== r) : [...bodyRegions, r]
                      );
                    }}
                    className={`text-[10px] rounded-md border px-2 py-1 ${on ? "border-primary bg-primary/10 text-primary" : "border-input"}`}
                  >
                    {r.replace(/_/g, " ")}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Sets</Label>
              <Input type="number" value={sets} onChange={(e) => setSets(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Reps</Label>
              <Input type="number" value={reps} onChange={(e) => setReps(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Hold (s)</Label>
              <Input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={isPerSide}
              onChange={(e) => setIsPerSide(e.target.checked)}
            />
            <span>Per side (per leg / per arm)</span>
          </label>
          <Button onClick={submit} disabled={create.isPending} className="w-full">
            {create.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            Add
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Members&apos; submissions stay hidden until a coach validates them.
            Coaches and admins create validated movements visible to their gym
            immediately.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
