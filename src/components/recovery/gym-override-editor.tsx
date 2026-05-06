"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  useUpsertGymOverride,
  useClearGymOverride,
} from "@/hooks/useRecoveryMovements";

interface GymOverrideEditorProps {
  movementId: string;
  communityId: string;
  communityName: string;
  /** The current override value, if any. Server-resolved. */
  notesOverride: string | null;
  /** The canonical movement description, shown as the fallback preview. */
  canonicalDescription: string | null;
}

/**
 * Coach/admin-only inline editor for the gym-specific notes override on a
 * recovery movement. Toggles between display and edit modes; saving calls
 * PUT, clearing calls DELETE on /gym-overrides.
 */
export function GymOverrideEditor({
  movementId,
  communityId,
  communityName,
  notesOverride,
  canonicalDescription,
}: GymOverrideEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notesOverride ?? "");
  const upsert = useUpsertGymOverride();
  const clear = useClearGymOverride();

  const hasOverride = notesOverride !== null && notesOverride !== "";

  const startEdit = () => {
    setDraft(notesOverride ?? canonicalDescription ?? "");
    setEditing(true);
  };

  const save = async () => {
    if (!draft.trim()) {
      toast.error("Note can't be empty — use Clear to remove the override");
      return;
    }
    try {
      await upsert.mutateAsync({
        movementId,
        communityId,
        notesOverride: draft.trim(),
      });
      toast.success(`Saved note for ${communityName}`);
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    }
  };

  const remove = async () => {
    try {
      await clear.mutateAsync({ movementId, communityId });
      toast.success("Cleared override");
      setEditing(false);
      setDraft("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to clear");
    }
  };

  return (
    <Card>
      <CardContent className="py-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Notes for {communityName}
          </p>
          {!editing && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={startEdit}
            >
              <Pencil className="h-3 w-3 mr-1" />
              {hasOverride ? "Edit" : "Add"}
            </Button>
          )}
        </div>

        {editing ? (
          <div className="space-y-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`Custom guidance shown to ${communityName} members…`}
              rows={4}
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={save}
                disabled={upsert.isPending}
              >
                {upsert.isPending && (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                )}
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setDraft(notesOverride ?? "");
                }}
                disabled={upsert.isPending}
              >
                Cancel
              </Button>
              {hasOverride && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto text-destructive hover:text-destructive"
                  onClick={remove}
                  disabled={clear.isPending}
                >
                  {clear.isPending ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3 mr-1" />
                  )}
                  Clear
                </Button>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Overrides the canonical movement description for {communityName}{" "}
              members only.
            </p>
          </div>
        ) : hasOverride ? (
          <p className="text-sm whitespace-pre-wrap">{notesOverride}</p>
        ) : (
          <p className="text-xs text-muted-foreground italic">
            No gym-specific note. The canonical description is shown to your
            members.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
