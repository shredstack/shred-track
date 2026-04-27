"use client";

import { useState, useRef, useEffect } from "react";
import { Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  value: string;
  onSave: (value: string) => Promise<void> | void;
  disabled?: boolean;
  className?: string;
}

export function EditableTitle({ value, onSave, disabled, className = "" }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const start = () => {
    if (disabled) return;
    setError(null);
    setDraft(value);
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setError(null);
    setDraft(value);
  };

  const save = async () => {
    const trimmed = draft.trim();
    if (trimmed.length < 1 || trimmed.length > 120) {
      setError("Title must be 1–120 characters");
      return;
    }
    if (trimmed === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={start}
        disabled={disabled}
        className={`group flex items-center gap-2 text-left ${disabled ? "" : "hover:opacity-80"} ${className}`}
      >
        <span className="font-bold truncate">{value}</span>
        {!disabled && (
          <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
        )}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") cancel();
          }}
          maxLength={120}
          className="flex-1 min-w-0 rounded-lg bg-white/[0.04] border border-white/[0.08] px-2 py-1 text-sm font-bold outline-none focus:border-primary/40"
        />
        <Button size="sm" onClick={save} disabled={saving} className="h-7 w-7 p-0">
          <Check className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={cancel}
          disabled={saving}
          className="h-7 w-7 p-0"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
