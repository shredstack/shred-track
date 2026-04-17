"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  LogOut,
  User,
  Dumbbell,
  Timer,
  Save,
  Pencil,
  X,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createClient } from "@/lib/supabase/client";
import {
  useUserProfile,
  useUpdateUserProfile,
  useFullHyroxProfile,
  useUpdateHyroxProfile,
  useUpdateStationAssessments,
  type FullHyroxProfile,
  type StationAssessment,
} from "@/hooks/useProfile";
import {
  DIVISIONS,
  STATION_ORDER,
  CONFIDENCE_LABELS,
  RACE_DIVISION_LABELS,
  formatTime,
  formatLongTime,
  type DivisionKey,
  type RaceDivisionKey,
} from "@/lib/hyrox-data";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPace(seconds: number | null, unit: string): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")} / ${unit}`;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// ---------------------------------------------------------------------------
// General Section
// ---------------------------------------------------------------------------

function GeneralSection() {
  const { data: user, isLoading } = useUserProfile();
  const updateUser = useUpdateUserProfile();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");

  const startEditing = useCallback(() => {
    if (user) {
      setName(user.name);
      setEditing(true);
    }
  }, [user]);

  const save = useCallback(() => {
    if (!name.trim()) return;
    updateUser.mutate({ name: name.trim() }, { onSuccess: () => setEditing(false) });
  }, [name, updateUser]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-bold text-muted-foreground uppercase tracking-wider">
          General
        </CardTitle>
        {!editing && (
          <Button variant="ghost" size="sm" onClick={startEditing}>
            <Pencil className="h-3.5 w-3.5 mr-1" />
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {editing ? (
          <>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">Email</Label>
              <p className="text-sm">{user.email}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={updateUser.isPending}>
                {updateUser.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                ) : (
                  <Save className="h-3.5 w-3.5 mr-1" />
                )}
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                <X className="h-3.5 w-3.5 mr-1" />
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground">Name</p>
              <p className="text-sm font-medium">{user.name}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Email</p>
              <p className="text-sm font-medium">{user.email}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Member since</p>
              <p className="text-sm font-medium">
                {new Date(user.createdAt).toLocaleDateString("en-US", {
                  month: "long",
                  year: "numeric",
                })}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// CrossFit Section (placeholder)
// ---------------------------------------------------------------------------

function CrossFitSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-bold text-muted-foreground uppercase tracking-wider">
          CrossFit
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground text-center py-8">
          CrossFit profile coming soon.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// HYROX Section
// ---------------------------------------------------------------------------

type HyroxEditState = {
  goalFinishTimeSeconds: string;
  nextRaceDate: string;
  targetDivision: DivisionKey;
  easyPace: string;
  moderatePace: string;
  fastPace: string;
  recent5kTime: string;
  recent800mRepeat: string;
  previousRaceCount: string;
  bestFinishTime: string;
  bestDivision: string;
  bestTimeNotes: string;
  crossfitDaysPerWeek: string;
  crossfitGymName: string;
  injuriesNotes: string;
  trainingPhilosophy: string;
  assessments: StationAssessment[];
};

function profileToEditState(p: FullHyroxProfile): HyroxEditState {
  return {
    goalFinishTimeSeconds: p.goalFinishTimeSeconds ? formatLongTime(p.goalFinishTimeSeconds) : "",
    nextRaceDate: p.nextRaceDate || "",
    targetDivision: p.targetDivision as DivisionKey,
    easyPace: p.easyPaceSecondsPerUnit ? formatTime(p.easyPaceSecondsPerUnit) : "",
    moderatePace: p.moderatePaceSecondsPerUnit ? formatTime(p.moderatePaceSecondsPerUnit) : "",
    fastPace: p.fastPaceSecondsPerUnit ? formatTime(p.fastPaceSecondsPerUnit) : "",
    recent5kTime: p.recent5kTimeSeconds ? formatLongTime(p.recent5kTimeSeconds) : "",
    recent800mRepeat: p.recent800mRepeatSeconds ? formatTime(p.recent800mRepeatSeconds) : "",
    previousRaceCount: String(p.previousRaceCount),
    bestFinishTime: p.bestFinishTimeSeconds ? formatLongTime(p.bestFinishTimeSeconds) : "",
    bestDivision: p.bestDivision || "",
    bestTimeNotes: p.bestTimeNotes || "",
    crossfitDaysPerWeek: String(p.crossfitDaysPerWeek ?? 5),
    crossfitGymName: p.crossfitGymName || "",
    injuriesNotes: p.injuriesNotes || "",
    trainingPhilosophy: p.trainingPhilosophy || "moderate",
    assessments: p.assessments,
  };
}

function parsePaceToSeconds(str: string): number | null {
  const parts = str.split(":");
  if (parts.length !== 2) return null;
  const m = parseInt(parts[0], 10);
  const s = parseInt(parts[1], 10);
  if (isNaN(m) || isNaN(s)) return null;
  return m * 60 + s;
}

function parseLongTimeToSeconds(str: string): number | null {
  const parts = str.split(":");
  if (parts.length === 3) {
    const [h, m, s] = parts.map((p) => parseInt(p, 10));
    if (isNaN(h) || isNaN(m) || isNaN(s)) return null;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const [m, s] = parts.map((p) => parseInt(p, 10));
    if (isNaN(m) || isNaN(s)) return null;
    return m * 60 + s;
  }
  return null;
}

function HyroxSectionEditing({
  initial,
  onSave,
  onCancel,
  isSaving,
}: {
  initial: HyroxEditState;
  onSave: (state: HyroxEditState) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [state, setState] = useState(initial);

  const set = useCallback(
    <K extends keyof HyroxEditState>(key: K, value: HyroxEditState[K]) => {
      setState((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  return (
    <div className="space-y-6">
      {/* Race Details */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
          Race Details
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Division</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={state.targetDivision}
              onChange={(e) => set("targetDivision", e.target.value as DivisionKey)}
            >
              {Object.entries(DIVISIONS).map(([key, spec]) => (
                <option key={key} value={key}>
                  {spec.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Goal Finish Time</Label>
            <Input
              placeholder="H:MM:SS"
              value={state.goalFinishTimeSeconds}
              onChange={(e) => set("goalFinishTimeSeconds", e.target.value)}
            />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs">Next Race Date</Label>
            <Input
              type="date"
              value={state.nextRaceDate}
              onChange={(e) => set("nextRaceDate", e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Running Paces */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
          Running Paces
        </h3>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Easy</Label>
            <Input
              placeholder="MM:SS"
              value={state.easyPace}
              onChange={(e) => set("easyPace", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Moderate</Label>
            <Input
              placeholder="MM:SS"
              value={state.moderatePace}
              onChange={(e) => set("moderatePace", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Fast</Label>
            <Input
              placeholder="MM:SS"
              value={state.fastPace}
              onChange={(e) => set("fastPace", e.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Recent 5K Time</Label>
            <Input
              placeholder="H:MM:SS"
              value={state.recent5kTime}
              onChange={(e) => set("recent5kTime", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">800m Repeat</Label>
            <Input
              placeholder="MM:SS"
              value={state.recent800mRepeat}
              onChange={(e) => set("recent800mRepeat", e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Race Experience */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
          Race Experience
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Races Completed</Label>
            <Input
              type="number"
              min="0"
              value={state.previousRaceCount}
              onChange={(e) => set("previousRaceCount", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Best Finish Time</Label>
            <Input
              placeholder="H:MM:SS"
              value={state.bestFinishTime}
              onChange={(e) => set("bestFinishTime", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Best Division</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={state.bestDivision}
              onChange={(e) => set("bestDivision", e.target.value)}
            >
              <option value="">—</option>
              {Object.entries(RACE_DIVISION_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Notes</Label>
          <Input
            placeholder="Race notes..."
            value={state.bestTimeNotes}
            onChange={(e) => set("bestTimeNotes", e.target.value)}
          />
        </div>
      </div>

      {/* Training Preferences */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
          Training Preferences
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">CrossFit Days/Week</Label>
            <Input
              type="number"
              min="1"
              max="7"
              value={state.crossfitDaysPerWeek}
              onChange={(e) => set("crossfitDaysPerWeek", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Philosophy</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={state.trainingPhilosophy}
              onChange={(e) => set("trainingPhilosophy", e.target.value)}
            >
              <option value="conservative">Conservative</option>
              <option value="moderate">Moderate</option>
              <option value="aggressive">Aggressive</option>
            </select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Gym Name</Label>
          <Input
            value={state.crossfitGymName}
            onChange={(e) => set("crossfitGymName", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Injuries / Notes</Label>
          <Input
            value={state.injuriesNotes}
            onChange={(e) => set("injuriesNotes", e.target.value)}
          />
        </div>
      </div>

      {/* Station Assessments */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
          Station Assessments
        </h3>
        <div className="space-y-2">
          {STATION_ORDER.map((station) => {
            const a = state.assessments.find((x) => x.station === station);
            return (
              <div
                key={station}
                className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2"
              >
                <span className="text-sm font-medium flex-1">{station}</span>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <span>Current:</span>
                    <Input
                      className="w-16 h-7 text-xs text-center"
                      value={a?.currentTimeSeconds ? formatTime(a.currentTimeSeconds) : ""}
                      onChange={(e) => {
                        const secs = parsePaceToSeconds(e.target.value);
                        setState((prev) => ({
                          ...prev,
                          assessments: prev.assessments.map((x) =>
                            x.station === station
                              ? { ...x, currentTimeSeconds: secs }
                              : x
                          ),
                        }));
                      }}
                      placeholder="M:SS"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span>Goal:</span>
                    <Input
                      className="w-16 h-7 text-xs text-center"
                      value={a?.goalTimeSeconds ? formatTime(a.goalTimeSeconds) : ""}
                      onChange={(e) => {
                        const secs = parsePaceToSeconds(e.target.value);
                        setState((prev) => ({
                          ...prev,
                          assessments: prev.assessments.map((x) =>
                            x.station === station
                              ? { ...x, goalTimeSeconds: secs }
                              : x
                          ),
                        }));
                      }}
                      placeholder="M:SS"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <Button size="sm" onClick={() => onSave(state)} disabled={isSaving}>
          {isSaving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
          ) : (
            <Save className="h-3.5 w-3.5 mr-1" />
          )}
          Save Changes
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <X className="h-3.5 w-3.5 mr-1" />
          Cancel
        </Button>
      </div>
    </div>
  );
}

function HyroxSectionDisplay({ profile }: { profile: FullHyroxProfile }) {
  const [expandedStations, setExpandedStations] = useState(false);
  const divisionLabel = DIVISIONS[profile.targetDivision as DivisionKey]?.label ?? profile.targetDivision;
  const paceUnit = profile.paceUnit === "mile" ? "mi" : "km";

  return (
    <div className="space-y-5">
      {/* Race Details */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
          Race Details
        </h3>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <div>
            <p className="text-xs text-muted-foreground">Division</p>
            <p className="text-sm font-medium">{divisionLabel}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Goal Finish Time</p>
            <p className="text-sm font-medium">
              {profile.goalFinishTimeSeconds
                ? formatLongTime(profile.goalFinishTimeSeconds)
                : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Next Race</p>
            <p className="text-sm font-medium">
              {profile.nextRaceDate
                ? new Date(profile.nextRaceDate + "T00:00:00").toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Gender</p>
            <p className="text-sm font-medium capitalize">{profile.gender ?? "—"}</p>
          </div>
        </div>
      </div>

      {/* Running Paces */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
          Running Paces
        </h3>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["Easy", profile.easyPaceSecondsPerUnit],
              ["Moderate", profile.moderatePaceSecondsPerUnit],
              ["Fast", profile.fastPaceSecondsPerUnit],
            ] as const
          ).map(([label, val]) => (
            <div key={label} className="rounded-lg bg-muted/30 p-2.5 text-center">
              <p className="text-[10px] text-muted-foreground">{label}</p>
              <p className="text-sm font-mono font-medium">{formatPace(val, paceUnit)}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-xs text-muted-foreground">Recent 5K</p>
            <p className="text-sm font-medium font-mono">
              {profile.recent5kTimeSeconds
                ? formatLongTime(profile.recent5kTimeSeconds)
                : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">800m Repeat</p>
            <p className="text-sm font-medium font-mono">
              {profile.recent800mRepeatSeconds
                ? formatTime(profile.recent800mRepeatSeconds)
                : "—"}
            </p>
          </div>
        </div>
      </div>

      {/* Race Experience */}
      {profile.previousRaceCount > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Race Experience
          </h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <div>
              <p className="text-xs text-muted-foreground">Races Completed</p>
              <p className="text-sm font-medium">{profile.previousRaceCount}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Best Finish Time</p>
              <p className="text-sm font-medium font-mono">
                {profile.bestFinishTimeSeconds
                  ? formatLongTime(profile.bestFinishTimeSeconds)
                  : "—"}
              </p>
            </div>
            {profile.bestDivision && (
              <div>
                <p className="text-xs text-muted-foreground">Best Division</p>
                <p className="text-sm font-medium">
                  {RACE_DIVISION_LABELS[profile.bestDivision as RaceDivisionKey] ??
                    profile.bestDivision}
                </p>
              </div>
            )}
          </div>
          {profile.bestTimeNotes && (
            <p className="text-xs text-muted-foreground italic">{profile.bestTimeNotes}</p>
          )}
        </div>
      )}

      {/* Training Preferences */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
          Training Preferences
        </h3>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <div>
            <p className="text-xs text-muted-foreground">CrossFit Days/Week</p>
            <p className="text-sm font-medium">{profile.crossfitDaysPerWeek ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Philosophy</p>
            <p className="text-sm font-medium capitalize">
              {profile.trainingPhilosophy ?? "—"}
            </p>
          </div>
          {profile.crossfitGymName && (
            <div>
              <p className="text-xs text-muted-foreground">Gym</p>
              <p className="text-sm font-medium">{profile.crossfitGymName}</p>
            </div>
          )}
        </div>
        {profile.injuriesNotes && (
          <div>
            <p className="text-xs text-muted-foreground">Injuries / Notes</p>
            <p className="text-sm italic">{profile.injuriesNotes}</p>
          </div>
        )}
      </div>

      {/* Station Assessments */}
      {profile.assessments.length > 0 && (
        <div className="space-y-2">
          <button
            className="flex items-center gap-1 w-full"
            onClick={() => setExpandedStations(!expandedStations)}
          >
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Station Assessments
            </h3>
            {expandedStations ? (
              <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>
          {expandedStations && (
            <div className="space-y-1.5">
              {STATION_ORDER.map((station) => {
                const a = profile.assessments.find((x) => x.station === station);
                if (!a) return null;
                return (
                  <div
                    key={station}
                    className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2"
                  >
                    <div className="flex-1">
                      <span className="text-sm font-medium">{station}</span>
                      <Badge variant="secondary" className="ml-2 text-[10px]">
                        {CONFIDENCE_LABELS[a.completionConfidence]}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
                      <span>{a.currentTimeSeconds ? formatTime(a.currentTimeSeconds) : "—"}</span>
                      <span className="text-muted-foreground/40">/</span>
                      <span className="text-primary">
                        {a.goalTimeSeconds ? formatTime(a.goalTimeSeconds) : "—"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HyroxSection() {
  const { data: profile, isLoading } = useFullHyroxProfile();
  const updateProfile = useUpdateHyroxProfile();
  const updateAssessments = useUpdateStationAssessments();
  const [editing, setEditing] = useState(false);

  const isSaving = updateProfile.isPending || updateAssessments.isPending;

  const handleSave = useCallback(
    (state: HyroxEditState) => {
      const profileData: Record<string, unknown> = {
        targetDivision: state.targetDivision,
        nextRaceDate: state.nextRaceDate || null,
        goalFinishTimeSeconds: parseLongTimeToSeconds(state.goalFinishTimeSeconds),
        easyPaceSecondsPerUnit: parsePaceToSeconds(state.easyPace),
        moderatePaceSecondsPerUnit: parsePaceToSeconds(state.moderatePace),
        fastPaceSecondsPerUnit: parsePaceToSeconds(state.fastPace),
        recent5kTimeSeconds: parseLongTimeToSeconds(state.recent5kTime),
        recent800mRepeatSeconds: parsePaceToSeconds(state.recent800mRepeat),
        previousRaceCount: parseInt(state.previousRaceCount, 10) || 0,
        bestFinishTimeSeconds: parseLongTimeToSeconds(state.bestFinishTime),
        bestDivision: state.bestDivision || null,
        bestTimeNotes: state.bestTimeNotes || null,
        crossfitDaysPerWeek: parseInt(state.crossfitDaysPerWeek, 10) || 5,
        crossfitGymName: state.crossfitGymName || null,
        injuriesNotes: state.injuriesNotes || null,
        trainingPhilosophy: state.trainingPhilosophy,
      };

      updateProfile.mutate(profileData as Partial<FullHyroxProfile>, {
        onSuccess: () => {
          if (state.assessments.length > 0) {
            updateAssessments.mutate(state.assessments, {
              onSuccess: () => setEditing(false),
            });
          } else {
            setEditing(false);
          }
        },
      });
    },
    [updateProfile, updateAssessments]
  );

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!profile) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-sm text-muted-foreground">
            No HYROX profile yet. Complete the onboarding to get started.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-bold text-muted-foreground uppercase tracking-wider">
          HYROX
        </CardTitle>
        {!editing && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5 mr-1" />
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {editing ? (
          <HyroxSectionEditing
            initial={profileToEditState(profile)}
            onSave={handleSave}
            onCancel={() => setEditing(false)}
            isSaving={isSaving}
          />
        ) : (
          <HyroxSectionDisplay profile={profile} />
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main Profile Page
// ---------------------------------------------------------------------------

export default function ProfilePage() {
  const router = useRouter();
  const { data: user } = useUserProfile();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const initials = user ? getInitials(user.name) : "ST";

  return (
    <div className="flex flex-col gap-6">
      {/* Profile header */}
      <div className="flex flex-col items-center gap-3 pt-2">
        <Avatar className="h-20 w-20 ring-2 ring-primary/20">
          <AvatarFallback className="bg-primary/10 text-xl font-bold text-primary">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="text-center">
          <h1 className="text-xl font-bold tracking-tight">{user?.name ?? "Athlete"}</h1>
          <p className="text-sm text-muted-foreground">{user?.email ?? "ShredTrack Member"}</p>
        </div>
      </div>

      {/* Tabbed sections */}
      <Tabs defaultValue="general">
        <TabsList className="w-full">
          <TabsTrigger value="general" className="flex-1 gap-1.5">
            <User className="h-3.5 w-3.5" />
            General
          </TabsTrigger>
          <TabsTrigger value="crossfit" className="flex-1 gap-1.5">
            <Dumbbell className="h-3.5 w-3.5" />
            CrossFit
          </TabsTrigger>
          <TabsTrigger value="hyrox" className="flex-1 gap-1.5">
            <Timer className="h-3.5 w-3.5" />
            HYROX
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-4">
          <GeneralSection />
        </TabsContent>

        <TabsContent value="crossfit" className="mt-4">
          <CrossFitSection />
        </TabsContent>

        <TabsContent value="hyrox" className="mt-4">
          <HyroxSection />
        </TabsContent>
      </Tabs>

      {/* Sign out */}
      <Card>
        <CardContent className="pt-4">
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-3 rounded-lg px-2 py-3.5 text-sm text-destructive transition-colors hover:bg-destructive/5 group"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive/10">
              <LogOut className="h-4 w-4" />
            </div>
            <span className="flex-1 text-left">Sign Out</span>
          </button>
        </CardContent>
      </Card>

      <p className="text-center text-[11px] text-muted-foreground/40">ShredTrack v0.1.0</p>
    </div>
  );
}
