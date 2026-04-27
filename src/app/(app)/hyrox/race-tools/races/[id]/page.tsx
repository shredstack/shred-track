"use client";

import { useState, useMemo, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Trash2,
  GitCompare,
  Notebook,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  usePracticeRace,
  usePracticeRaces,
  useUpdatePracticeRace,
  useDeletePracticeRace,
  sortRacesNewestFirst,
} from "@/hooks/usePracticeRaces";
import { RaceDetailHeader } from "@/components/hyrox/race-history/race-detail-header";
import { RaceSplitsTable } from "@/components/hyrox/race-history/race-splits-table";
import { EditableNotes } from "@/components/hyrox/race-history/editable-notes";
import { RaceCompareView } from "@/components/hyrox/race-history/race-compare-view";
import { RaceReportCard } from "@/components/hyrox/race-history/race-report-card";

export default function RaceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const { data: race, isLoading, error } = usePracticeRace(id);
  const { data: allRaces = [] } = usePracticeRaces();
  const updateRace = useUpdatePracticeRace();
  const deleteRace = useDeletePracticeRace();

  const [compareTo, setCompareTo] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [raceTypePending, setRaceTypePending] = useState(false);

  const compareCandidates = useMemo(() => {
    if (!race) return [];
    const sorted = sortRacesNewestFirst(allRaces);
    return sorted.filter(
      (r) => r.id !== race.id && r.template === race.template,
    );
  }, [allRaces, race]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 animate-pulse">
        <div className="h-40 rounded-xl bg-white/[0.04]" />
        <div className="h-64 rounded-xl bg-white/[0.04]" />
        <div className="h-32 rounded-xl bg-white/[0.04]" />
      </div>
    );
  }

  if (error || !race) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <AlertTriangle className="h-6 w-6 text-amber-400" />
          <p className="text-sm font-semibold">Race not found</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            This race might have been deleted or doesn&apos;t belong to your account.
          </p>
          <Link href="/hyrox/race-tools/races">
            <Button variant="outline" size="sm" className="gap-1 mt-1">
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to races
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const totalSeconds = parseFloat(race.totalTimeSeconds);

  const handleTitleSave = async (title: string) => {
    await updateRace.mutateAsync({ id: race.id, title });
  };

  const handleNotesSave = async (notes: string | null) => {
    await updateRace.mutateAsync({ id: race.id, notes });
  };

  const handleRaceTypeToggle = async () => {
    setRaceTypePending(true);
    try {
      await updateRace.mutateAsync({
        id: race.id,
        raceType: race.raceType === "actual" ? "practice" : "actual",
      });
    } finally {
      setRaceTypePending(false);
    }
  };

  const handleDelete = async () => {
    await deleteRace.mutateAsync(race.id);
    router.push("/hyrox/race-tools/races");
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header / nav */}
      <div className="flex items-center justify-between gap-2">
        <Link href="/hyrox/race-tools/races">
          <Button variant="ghost" size="sm" className="gap-1 h-8 -ml-2">
            <ArrowLeft className="h-3.5 w-3.5" />
            Races
          </Button>
        </Link>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 h-8 text-xs"
          onClick={handleRaceTypeToggle}
          disabled={raceTypePending}
        >
          {race.raceType === "actual"
            ? "Mark as practice"
            : "Mark as actual race"}
        </Button>
      </div>

      <RaceDetailHeader race={race} onTitleSave={handleTitleSave} />

      {/* Notes */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Notebook className="h-3.5 w-3.5 text-muted-foreground" />
            Notes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EditableNotes value={race.notes} onSave={handleNotesSave} />
        </CardContent>
      </Card>

      {/* Splits */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold">Splits</CardTitle>
        </CardHeader>
        <CardContent>
          <RaceSplitsTable
            splits={race.splits}
            divisionKey={race.divisionKey}
          />
        </CardContent>
      </Card>

      {/* AI Race Report */}
      <RaceReportCard
        raceId={race.id}
        currentFinishSeconds={Math.round(totalSeconds)}
      />

      {/* Compare */}
      {compareCandidates.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <GitCompare className="h-3.5 w-3.5 text-muted-foreground" />
              Compare to
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Select
              value={compareTo ?? ""}
              onValueChange={(v) => setCompareTo(v || null)}
            >
              <SelectTrigger className="text-xs h-9">
                <SelectValue placeholder="Pick a previous race…" />
              </SelectTrigger>
              <SelectContent>
                {compareCandidates.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.title || "Practice Race"} ·{" "}
                    {new Date(r.completedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {compareTo && (
              <RaceCompareView current={race} compareToId={compareTo} />
            )}
          </CardContent>
        </Card>
      )}

      {/* Danger zone */}
      <Button
        variant="outline"
        className="gap-2 text-red-400 border-red-500/30 hover:bg-red-500/10 hover:text-red-300"
        onClick={() => setConfirmDelete(true)}
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete race
      </Button>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this race?</DialogTitle>
            <DialogDescription>
              Splits will be removed but station best times will remain in your
              history. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              disabled={deleteRace.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteRace.isPending}
            >
              {deleteRace.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
