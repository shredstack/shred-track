"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  communityId: string;
  weekStart: string;
  onSaved: () => void;
}

export function CapPasteDialog({
  open,
  onOpenChange,
  communityId,
  weekStart,
  onSaved,
}: Props) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!text.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/gym/${communityId}/programming/cap-paste`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ weekStart, text }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to import");
      }
      const data = (await res.json()) as { days: number };
      toast.success(`Imported ${data.days} day(s) as draft.`);
      setText("");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Paste CAP week</DialogTitle>
          <DialogDescription>
            Paste raw CAP-style text. The parser splits on day headers
            (MONDAY, Mon 5/19, Day 1) and section headings (Warm-up, WOD,
            Strength, Cool-down). Already-reviewed sections are preserved.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={14}
          placeholder={`MONDAY\nWarm-up\n3 rounds: 10 air squats, 10 push-ups\n\nWOD\nFor time:\n21-15-9 thrusters / pull-ups\n…`}
          className="font-mono text-xs"
        />
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !text.trim()}>
            {submitting && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Import as draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
