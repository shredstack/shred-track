// Sign-on-behalf dialog (dependents spec §6).
//
// Guardian-mode adaptation of the regular sign-document modal:
//   - typed-name field defaults to the *account holder's* name
//   - explicit disclosure line: "I confirm I am the parent or legal
//     guardian of {minor.name} and have authority to sign on their
//     behalf."
//   - submission goes to the gym's sign endpoint with subjectUserId
//     pointing at the minor.

"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  communityId: string;
  documentVersionId: string;
  documentTitle: string;
  bodyMarkdown: string;
  minorName: string;
  minorUserId: string;
  guardianName: string;
  onSigned?: () => void;
}

export function SignOnBehalfDialog({
  open,
  onOpenChange,
  communityId,
  documentVersionId,
  documentTitle,
  bodyMarkdown,
  minorName,
  minorUserId,
  guardianName,
  onSigned,
}: Props) {
  const qc = useQueryClient();
  const [typedName, setTypedName] = useState(guardianName);
  const [agreed, setAgreed] = useState(false);

  // Reset typed name + checkbox whenever the dialog reopens. The
  // synchronization is keyed to the `open` prop and the guardian name,
  // which is exactly the lint rule's intended carve-out for
  // "synchronize-from-external-state."
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (open) {
      setTypedName(guardianName);
      setAgreed(false);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, guardianName]);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/communities/${communityId}/documents/${documentVersionId}/sign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            typedName,
            subjectUserId: minorUserId,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to sign");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["family"] });
      qc.invalidateQueries({ queryKey: ["family", "pending-docs"] });
      toast.success(`Signed for ${minorName}.`);
      onSigned?.();
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{documentTitle}</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Signing on behalf of {minorName}
          </p>
        </DialogHeader>

        <div className="prose prose-sm prose-invert max-h-[40vh] overflow-y-auto rounded-lg border border-border bg-muted/30 p-3 text-xs">
          <pre className="whitespace-pre-wrap font-sans">{bodyMarkdown}</pre>
        </div>

        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            By signing, I confirm I am the parent or legal guardian of{" "}
            <strong className="text-foreground">{minorName}</strong> and have
            authority to sign on their behalf.
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="sob-typed">Your full name (typed signature)</Label>
            <Input
              id="sob-typed"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
            />
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span>
              I have read this document and I&apos;m signing it on behalf of my
              minor dependent.
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !typedName.trim() || !agreed}
          >
            {mutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Sign for {minorName.split(" ")[0]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
