"use client";

import { useState, useCallback, useMemo } from "react";
import {
  X,
  ArrowDownUp,
  Gauge,
  Pencil,
  SkipForward,
  Check,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useEditSession } from "@/hooks/useHyroxPlan";
import {
  STATION_SUBSTITUTIONS,
  type SessionDetail,
  type SessionBlock,
  type Substitution,
} from "@/types/hyrox-plan";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EditMode = "substitute" | "intensity" | "custom" | "skip" | null;

type IntensityLevel = "lighter" | "as_planned" | "harder";

interface SessionEditModalProps {
  session: {
    id: string;
    title: string;
    description: string;
    sessionType: string;
    sessionDetail: SessionDetail;
    equipmentRequired: string[];
  };
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find which equipment from the session has available substitutions. */
function findSubstitutableEquipment(
  equipmentRequired: string[],
  blocks: SessionBlock[]
): string[] {
  const allMovementEquipment = new Set<string>();
  for (const block of blocks) {
    for (const movement of block.movements) {
      if (movement.equipmentNeeded) {
        allMovementEquipment.add(movement.equipmentNeeded);
      }
    }
  }

  // Also check equipment list from session
  for (const eq of equipmentRequired) {
    allMovementEquipment.add(eq);
  }

  // Return only those that have substitution entries
  return Array.from(allMovementEquipment).filter(
    (eq) => eq in STATION_SUBSTITUTIONS
  );
}

/** Apply substitutions to blocks, replacing movements that use the given equipment. */
function applySubstitutions(
  blocks: SessionBlock[],
  substitutions: Record<string, Substitution>
): SessionBlock[] {
  return blocks.map((block) => ({
    ...block,
    movements: block.movements.map((movement) => {
      // Check if this movement's equipment or name matches a substitution key
      const subKey =
        Object.keys(substitutions).find(
          (key) =>
            movement.equipmentNeeded === key ||
            movement.name.includes(key)
        );
      if (subKey) {
        const sub = substitutions[subKey];
        return {
          ...movement,
          name: sub.name,
          prescription: sub.prescription,
          equipmentNeeded: undefined,
          notes: `Substituted for ${subKey}`,
        };
      }
      return movement;
    }),
  }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SessionEditModal({
  session,
  open,
  onClose,
  onSaved,
}: SessionEditModalProps) {
  const editSession = useEditSession();

  // --- Shared state ---
  const [mode, setMode] = useState<EditMode>(null);

  // --- Substitute state ---
  const substitutableEquipment = useMemo(
    () =>
      findSubstitutableEquipment(
        session.equipmentRequired,
        session.sessionDetail.blocks
      ),
    [session.equipmentRequired, session.sessionDetail.blocks]
  );
  const [unavailableEquipment, setUnavailableEquipment] = useState<
    Set<string>
  >(new Set());
  const [selectedSubs, setSelectedSubs] = useState<
    Record<string, Substitution>
  >({});

  // --- Intensity state ---
  const [intensity, setIntensity] = useState<IntensityLevel>("as_planned");

  // --- Custom edit state ---
  const [customTitle, setCustomTitle] = useState(session.title);
  const [customDescription, setCustomDescription] = useState(
    session.description
  );

  // --- Skip state ---
  const [skipReason, setSkipReason] = useState("");

  // --- Handlers ---

  const resetState = useCallback(() => {
    setMode(null);
    setUnavailableEquipment(new Set());
    setSelectedSubs({});
    setIntensity("as_planned");
    setCustomTitle(session.title);
    setCustomDescription(session.description);
    setSkipReason("");
  }, [session.title, session.description]);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  const toggleUnavailable = useCallback(
    (equipment: string) => {
      setUnavailableEquipment((prev) => {
        const next = new Set(prev);
        if (next.has(equipment)) {
          next.delete(equipment);
          // Also remove the selected substitution
          setSelectedSubs((s) => {
            const copy = { ...s };
            delete copy[equipment];
            return copy;
          });
        } else {
          next.add(equipment);
        }
        return next;
      });
    },
    []
  );

  const selectSubstitution = useCallback(
    (equipment: string, sub: Substitution) => {
      setSelectedSubs((prev) => ({ ...prev, [equipment]: sub }));
    },
    []
  );

  const handleSave = useCallback(async () => {
    let data: Record<string, unknown> = {};

    switch (mode) {
      case "substitute": {
        const newBlocks = applySubstitutions(
          session.sessionDetail.blocks,
          selectedSubs
        );
        const subNotes = Object.entries(selectedSubs)
          .map(([eq, sub]) => `${eq} -> ${sub.name}`)
          .join("; ");
        data = {
          sessionDetail: {
            ...session.sessionDetail,
            blocks: newBlocks,
            coachNotes: [
              session.sessionDetail.coachNotes,
              `Equipment substitutions: ${subNotes}`,
            ]
              .filter(Boolean)
              .join("\n"),
          },
          equipmentRequired: session.equipmentRequired.filter(
            (eq) => !unavailableEquipment.has(eq)
          ),
        };
        break;
      }
      case "intensity": {
        if (intensity === "as_planned") {
          // No changes needed
          handleClose();
          return;
        }
        const prefix = intensity === "lighter" ? "[Lighter]" : "[Harder]";
        const note =
          intensity === "lighter"
            ? "Scaled down ~20% volume/distance"
            : "Scaled up ~20% volume/distance";
        data = {
          description: `${prefix} ${session.description}`,
          sessionDetail: {
            ...session.sessionDetail,
            coachNotes: [session.sessionDetail.coachNotes, note]
              .filter(Boolean)
              .join("\n"),
          },
        };
        break;
      }
      case "custom": {
        data = {
          title: customTitle,
          description: customDescription,
        };
        break;
      }
      case "skip": {
        data = {
          status: "skipped",
          description: skipReason
            ? `[Skipped] ${skipReason}`
            : `[Skipped] ${session.description}`,
          sessionDetail: {
            ...session.sessionDetail,
            coachNotes: [
              session.sessionDetail.coachNotes,
              skipReason ? `Skipped: ${skipReason}` : "Session skipped",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        };
        break;
      }
      default:
        return;
    }

    await editSession.mutateAsync({ sessionId: session.id, data });
    resetState();
    onSaved();
  }, [
    mode,
    session,
    selectedSubs,
    unavailableEquipment,
    intensity,
    customTitle,
    customDescription,
    skipReason,
    editSession,
    resetState,
    onSaved,
    handleClose,
  ]);

  // --- Derived ---
  const canSave = useMemo(() => {
    switch (mode) {
      case "substitute":
        return (
          unavailableEquipment.size > 0 &&
          Array.from(unavailableEquipment).every((eq) => selectedSubs[eq])
        );
      case "intensity":
        return true;
      case "custom":
        return customTitle.trim().length > 0;
      case "skip":
        return true;
      default:
        return false;
    }
  }, [mode, unavailableEquipment, selectedSubs, customTitle]);

  // --- Render ---
  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Session</DialogTitle>
          <DialogDescription>
            Customize this session to fit your needs.
          </DialogDescription>
        </DialogHeader>

        {/* Session summary */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{session.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {session.description}
            </p>
            {session.sessionDetail.blocks.length > 0 && (
              <div className="space-y-1">
                {session.sessionDetail.blocks.map((block, i) => (
                  <div key={i}>
                    <p className="text-xs font-medium">{block.label}</p>
                    <ul className="ml-3 space-y-0.5">
                      {block.movements.map((m, j) => (
                        <li
                          key={j}
                          className="text-xs text-muted-foreground"
                        >
                          {m.name} &mdash; {m.prescription}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            {session.equipmentRequired.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {session.equipmentRequired.map((eq) => (
                  <Badge key={eq} variant="secondary" className="text-[10px]">
                    {eq}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Mode selection (when no mode is chosen) */}
        {mode === null && (
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="flex h-auto flex-col gap-1 py-3"
              onClick={() => setMode("substitute")}
              disabled={substitutableEquipment.length === 0}
            >
              <ArrowDownUp className="h-4 w-4" />
              <span className="text-xs">Substitute</span>
            </Button>
            <Button
              variant="outline"
              className="flex h-auto flex-col gap-1 py-3"
              onClick={() => setMode("intensity")}
            >
              <Gauge className="h-4 w-4" />
              <span className="text-xs">Intensity</span>
            </Button>
            <Button
              variant="outline"
              className="flex h-auto flex-col gap-1 py-3"
              onClick={() => setMode("custom")}
            >
              <Pencil className="h-4 w-4" />
              <span className="text-xs">Custom Edit</span>
            </Button>
            <Button
              variant="outline"
              className="flex h-auto flex-col gap-1 py-3"
              onClick={() => setMode("skip")}
            >
              <SkipForward className="h-4 w-4" />
              <span className="text-xs">Skip</span>
            </Button>
          </div>
        )}

        {/* Substitute Equipment */}
        {mode === "substitute" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <ArrowDownUp className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-medium">Substitute Equipment</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Mark equipment you don&apos;t have access to, then choose a
              replacement.
            </p>

            {substitutableEquipment.map((equipment) => (
              <Card key={equipment}>
                <CardContent className="space-y-2 py-3">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={unavailableEquipment.has(equipment)}
                      onChange={() => toggleUnavailable(equipment)}
                      className="h-4 w-4 rounded border-input accent-primary"
                    />
                    <span className="text-sm font-medium">{equipment}</span>
                    {unavailableEquipment.has(equipment) && (
                      <Badge variant="destructive" className="text-[10px]">
                        Unavailable
                      </Badge>
                    )}
                  </label>

                  {unavailableEquipment.has(equipment) && (
                    <div className="ml-6 space-y-1.5">
                      <p className="text-xs text-muted-foreground">
                        Choose a replacement:
                      </p>
                      {STATION_SUBSTITUTIONS[equipment]?.map((sub, i) => (
                        <label
                          key={i}
                          className="flex cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-1.5 hover:bg-muted/50"
                        >
                          <input
                            type="radio"
                            name={`sub-${equipment}`}
                            checked={
                              selectedSubs[equipment]?.name === sub.name
                            }
                            onChange={() =>
                              selectSubstitution(equipment, sub)
                            }
                            className="h-3.5 w-3.5 accent-primary"
                          />
                          <div>
                            <p className="text-sm">{sub.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {sub.prescription}
                            </p>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Adjust Intensity */}
        {mode === "intensity" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-medium">Adjust Intensity</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Scale the session volume and distance up or down by roughly 20%.
            </p>

            <div className="space-y-2">
              {(
                [
                  {
                    value: "lighter" as const,
                    label: "Lighter",
                    desc: "Reduce volume/distance ~20%",
                  },
                  {
                    value: "as_planned" as const,
                    label: "As Planned",
                    desc: "Keep the session as-is",
                  },
                  {
                    value: "harder" as const,
                    label: "Harder",
                    desc: "Increase volume/distance ~20%",
                  },
                ] as const
              ).map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                    intensity === option.value
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="intensity"
                    checked={intensity === option.value}
                    onChange={() => setIntensity(option.value)}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  <div>
                    <p className="text-sm font-medium">{option.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {option.desc}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Custom Edit */}
        {mode === "custom" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Pencil className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-medium">Custom Edit</h3>
            </div>

            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder="Session title"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                value={customDescription}
                onChange={(e) => setCustomDescription(e.target.value)}
                placeholder="Describe the session..."
                rows={4}
              />
            </div>
          </div>
        )}

        {/* Skip Session */}
        {mode === "skip" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <SkipForward className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-medium">Skip Session</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Mark this session as skipped. You can optionally provide a reason.
            </p>

            <div className="space-y-1.5">
              <Label>Reason (optional)</Label>
              <Textarea
                value={skipReason}
                onChange={(e) => setSkipReason(e.target.value)}
                placeholder="e.g. Traveling, minor injury, schedule conflict..."
                rows={3}
              />
            </div>
          </div>
        )}

        {/* Footer */}
        {mode !== null && (
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode(null)}>
              Back
            </Button>
            <Button
              onClick={handleSave}
              disabled={!canSave || editSession.isPending}
            >
              {editSession.isPending ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="mr-1 h-4 w-4" />
                  {mode === "skip" ? "Skip Session" : "Save Changes"}
                </>
              )}
            </Button>
          </DialogFooter>
        )}

        {/* Error display */}
        {editSession.isError && (
          <p className="text-xs text-destructive">
            {editSession.error?.message || "Something went wrong. Try again."}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
