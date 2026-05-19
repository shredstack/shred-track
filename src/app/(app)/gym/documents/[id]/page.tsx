"use client";

// Admin document version editor (PR 3 §3.2).
//
// One document at a time. Header lets the admin tweak title /
// required-on-join / is_active. Body is a markdown textarea — clicking
// "Publish version" creates a new document_versions row (v1 just
// stores the raw markdown; the member-facing renderer doesn't bother
// parsing it as HTML for the legal substance is the typed
// agreement, not formatting fidelity).

import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useGymContext } from "@/hooks/useGymContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { FileText, Loader2, Save, UploadCloud } from "lucide-react";
import { DOCUMENT_KIND_LABELS } from "@/db/schema";
import { GymToolHeader } from "@/components/gym/gym-tool-header";

interface DocumentRow {
  id: string;
  communityId: string;
  kind: string;
  title: string;
  isRequiredOnJoin: boolean;
  isActive: boolean;
}

interface DocumentVersionRow {
  id: string;
  version: number;
  bodyMarkdown: string;
  publishedAt: string;
}

export default function DocumentEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: docId } = use(params);
  const { data: ctx } = useGymContext();
  const activeId = ctx?.activeCommunityId ?? null;
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{
    document: DocumentRow;
    versions: DocumentVersionRow[];
  }>({
    queryKey: ["gym", activeId, "documents", docId],
    enabled: !!activeId,
    queryFn: async () => {
      const res = await fetch(`/api/gym/${activeId}/documents/${docId}`);
      if (!res.ok) throw new Error("Failed to load document");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!data) return null;

  return (
    <DocumentEditor
      key={
        data.versions[data.versions.length - 1]?.id ??
        `${data.document.id}-empty`
      }
      activeId={activeId}
      docId={docId}
      document={data.document}
      versions={data.versions}
      qc={qc}
    />
  );
}

function DocumentEditor({
  activeId,
  docId,
  document,
  versions,
  qc,
}: {
  activeId: string | null;
  docId: string;
  document: DocumentRow;
  versions: DocumentVersionRow[];
  qc: ReturnType<typeof useQueryClient>;
}) {
  const latest = versions[versions.length - 1];
  const [title, setTitle] = useState(document.title);
  const [isRequiredOnJoin, setIsRequiredOnJoin] = useState(
    document.isRequiredOnJoin
  );
  const [isActive, setIsActive] = useState(document.isActive);
  const [body, setBody] = useState(latest?.bodyMarkdown ?? "");

  const updateMeta = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/gym/${activeId}/documents/${docId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), isRequiredOnJoin, isActive }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to save");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["gym", activeId, "documents", docId],
      });
      qc.invalidateQueries({ queryKey: ["gym", activeId, "documents"] });
      toast.success("Saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const publish = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/gym/${activeId}/documents/${docId}/versions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bodyMarkdown: body }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to publish");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["gym", activeId, "documents", docId],
      });
      qc.invalidateQueries({ queryKey: ["gym", activeId, "documents"] });
      toast.success("Version published. Members will see the re-sign banner.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const dirty = latest ? body !== latest.bodyMarkdown : body.trim().length > 0;

  return (
    <div className="space-y-4">
      <GymToolHeader
        icon={FileText}
        label={document.title}
        description={
          latest ? `Version ${latest.version} published` : "Draft (no published version yet)"
        }
        backHref="/gym/documents"
        backLabel="Documents"
      />

      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Badge variant="secondary">
              {DOCUMENT_KIND_LABELS[
                document.kind as keyof typeof DOCUMENT_KIND_LABELS
              ] ?? document.kind}
            </Badge>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={isRequiredOnJoin}
                onChange={(e) => setIsRequiredOnJoin(e.target.checked)}
              />
              Required on join
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              Active
            </label>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => updateMeta.mutate()}
              disabled={updateMeta.isPending}
              className="ml-auto"
            >
              {updateMeta.isPending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="mr-1 h-3.5 w-3.5" />
              )}
              Save metadata
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">
                {latest ? `Version ${latest.version}` : "No published version"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Edit the body and click Publish to release a new version.
                Existing signatures stay on the prior version and members
                will be prompted to re-sign.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => publish.mutate()}
              disabled={publish.isPending || !body.trim() || !dirty}
            >
              {publish.isPending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <UploadCloud className="mr-1 h-3.5 w-3.5" />
              )}
              Publish new version
            </Button>
          </div>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={20}
            placeholder="Document body (markdown)…"
            className="font-mono text-xs"
          />
        </CardContent>
      </Card>

      {versions.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Version history
            </p>
            <ul className="space-y-1.5 text-sm">
              {[...versions]
                .sort((a, b) => b.version - a.version)
                .map((v) => (
                  <li
                    key={v.id}
                    className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-1.5"
                  >
                    <span>Version {v.version}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {new Date(v.publishedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
