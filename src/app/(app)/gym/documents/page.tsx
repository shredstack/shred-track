"use client";

// Gym admin documents list (PR 3 §3.2).
//
// Lists every document for the active gym, lets the admin create new
// ones, and links into the per-document version editor.

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useGymContext } from "@/hooks/useGymContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { FileText, Plus, ChevronRight, Loader2 } from "lucide-react";
import { DOCUMENT_KINDS, DOCUMENT_KIND_LABELS } from "@/db/schema";

interface DocRow {
  id: string;
  kind: string;
  title: string;
  isRequiredOnJoin: boolean;
  isActive: boolean;
  createdAt: string;
  latestVersion: number | null;
  latestPublishedAt: string | null;
}

export default function GymDocumentsPage() {
  const { data: ctx } = useGymContext();
  const activeId = ctx?.activeCommunityId ?? null;
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<string>("waiver");
  const [isRequiredOnJoin, setIsRequiredOnJoin] = useState(true);

  const { data, isLoading } = useQuery<{ documents: DocRow[] }>({
    queryKey: ["gym", activeId, "documents"],
    enabled: !!activeId,
    queryFn: async () => {
      const res = await fetch(`/api/gym/${activeId}/documents`);
      if (!res.ok) throw new Error("Failed to load documents");
      return res.json();
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/gym/${activeId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          kind,
          isRequiredOnJoin,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to create");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gym", activeId, "documents"] });
      setOpen(false);
      setTitle("");
      setKind("waiver");
      setIsRequiredOnJoin(true);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!activeId) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Pick a gym to manage documents.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Documents</h1>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          New document
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Waivers and policies new members must sign before they can fully
        participate. Publishing a new version asks every existing member to
        review and re-sign.
      </p>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (data?.documents ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No documents yet. Create your first waiver.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {data?.documents.map((d) => (
            <Link
              key={d.id}
              href={`/gym/documents/${d.id}`}
              className="block"
            >
              <Card className="hover:bg-muted/30 transition-colors">
                <CardContent className="flex items-center gap-3 py-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                    <FileText className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{d.title}</p>
                      {!d.isActive && (
                        <Badge variant="secondary" className="text-[10px]">
                          Inactive
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {DOCUMENT_KIND_LABELS[
                        d.kind as keyof typeof DOCUMENT_KIND_LABELS
                      ] ?? d.kind}
                      {" • "}
                      {d.latestVersion != null
                        ? `v${d.latestVersion}`
                        : "no version yet"}
                      {d.isRequiredOnJoin ? " • required on join" : ""}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New document</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. General Waiver"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Kind</Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                {DOCUMENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {DOCUMENT_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isRequiredOnJoin}
                onChange={(e) => setIsRequiredOnJoin(e.target.checked)}
              />
              Required when a new member joins
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => create.mutate()}
              disabled={!title.trim() || create.isPending}
            >
              {create.isPending && (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              )}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
