"use client";

import { useState, useEffect } from "react";
import { Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  value: string | null;
  onSave: (value: string | null) => Promise<void> | void;
  disabled?: boolean;
}

export function EditableNotes({ value, onSave, disabled }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);

  const start = () => {
    if (disabled) return;
    setError(null);
    setDraft(value ?? "");
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setError(null);
    setDraft(value ?? "");
  };

  const save = async () => {
    if (draft.length > 2000) {
      setError("Notes must be 2000 characters or fewer");
      return;
    }
    const next = draft.trim() === "" ? null : draft;
    if (next === (value ?? null)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex items-start gap-2">
        <p className="flex-1 min-w-0 text-sm whitespace-pre-wrap text-muted-foreground">
          {value && value.trim().length > 0 ? value : (
            <span className="italic text-muted-foreground/60">No notes</span>
          )}
        </p>
        {!disabled && (
          <Button
            variant="ghost"
            size="sm"
            onClick={start}
            className="h-7 w-7 p-0 shrink-0"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
        maxLength={2000}
        placeholder="Add notes about this race…"
        className="w-full rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-sm placeholder:text-muted-foreground outline-none focus:border-primary/40 resize-none"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">
          {draft.length}/2000
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={cancel}
            disabled={saving}
            className="h-7 gap-1"
          >
            <X className="h-3 w-3" /> Cancel
          </Button>
          <Button onClick={save} disabled={saving} size="sm" className="h-7 gap-1">
            <Check className="h-3 w-3" /> {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
