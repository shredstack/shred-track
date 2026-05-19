"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, FileCheck } from "lucide-react";

interface PendingDoc {
  documentId: string;
  title: string;
  kind: string;
  isRequiredOnJoin: boolean;
  versionId: string;
  versionNumber: number;
  bodyMarkdown: string;
  isResign: boolean;
}

export function SignDocumentsClient({
  communityId,
  gymName,
}: {
  communityId: string;
  gymName: string;
}) {
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ pending: PendingDoc[] }>({
    queryKey: ["communities", communityId, "pending-documents"],
    queryFn: async () => {
      const res = await fetch(
        `/api/communities/${communityId}/pending-documents`
      );
      if (!res.ok) throw new Error("Failed to load pending documents");
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

  const pending = data?.pending ?? [];

  if (pending.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-3 py-8 text-center">
          <FileCheck className="mx-auto h-10 w-10 text-primary" />
          <p className="text-sm font-medium">You&apos;re all set.</p>
          <p className="text-xs text-muted-foreground">
            No more documents to sign for {gymName}.
          </p>
          <Button onClick={() => router.push("/home")}>Continue</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {pending.map((doc) => (
        <SignSingleDoc
          key={doc.versionId}
          doc={doc}
          communityId={communityId}
          onSigned={() => {
            qc.invalidateQueries({
              queryKey: ["communities", communityId, "pending-documents"],
            });
          }}
        />
      ))}
    </div>
  );
}

function SignSingleDoc({
  doc,
  communityId,
  onSigned,
}: {
  doc: PendingDoc;
  communityId: string;
  onSigned: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [done, setDone] = useState(false);

  const sign = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/communities/${communityId}/documents/${doc.versionId}/sign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ typedName: typedName.trim() }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to sign");
      }
    },
    onSuccess: () => {
      setDone(true);
      onSigned();
      toast.success(`Signed: ${doc.title}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (done) {
    return (
      <Card className="border-primary/40 bg-primary/[0.04]">
        <CardContent className="flex items-center gap-3 py-4">
          <FileCheck className="h-5 w-5 text-primary" />
          <div className="flex-1">
            <p className="text-sm font-medium">{doc.title}</p>
            <p className="text-[11px] text-muted-foreground">
              Signed as &ldquo;{typedName.trim()}&rdquo;
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 py-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {doc.isResign ? "Updated — please re-sign" : "Required"}
          </p>
          <p className="text-sm font-medium">
            {doc.title}{" "}
            <span className="text-[11px] text-muted-foreground">
              v{doc.versionNumber}
            </span>
          </p>
        </div>

        <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed">
          {doc.bodyMarkdown}
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-1"
          />
          <span>
            I have read and agree to the terms of this {doc.title}.
          </span>
        </label>

        <div className="space-y-1.5">
          <Label>Type your full legal name</Label>
          <Input
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            placeholder="Your full name"
          />
        </div>

        <Button
          onClick={() => sign.mutate()}
          disabled={!agreed || !typedName.trim() || sign.isPending}
          className="w-full"
        >
          {sign.isPending ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : null}
          Sign {doc.title}
        </Button>
      </CardContent>
    </Card>
  );
}
