// Per-dependent "Documents" subsection (dependents spec §6).
// Only rendered when the documents flow exists for the gym.
//
// - Minor + unsigned: "Sign on behalf of {name}" → opens SignOnBehalfDialog
// - Adult + unsigned: "Send to {name}" → triggers an email reminder
//   (handled here as a toast; backend wiring is out of v1 unless the
//    gym has a sign-reminder endpoint — we surface a placeholder
//    explanation instead of silently failing).

"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SignOnBehalfDialog } from "./SignOnBehalfDialog";
import type { FamilyMemberDTO } from "@/hooks/useFamily";

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

interface Props {
  member: FamilyMemberDTO;
  guardianName: string;
}

export function FamilyMemberDocsSection({ member, guardianName }: Props) {
  const [signing, setSigning] = useState<PendingDoc | null>(null);

  const { data, isLoading } = useQuery<{ pending: PendingDoc[] }>({
    queryKey: ["family", "pending-docs", member.familyMemberId],
    queryFn: async () => {
      const res = await fetch(
        `/api/family/${member.familyMemberId}/pending-documents`
      );
      if (!res.ok) throw new Error("Failed to load pending docs");
      return res.json();
    },
    staleTime: 30_000,
  });

  const pending = data?.pending ?? [];
  if (isLoading) return null;
  if (pending.length === 0) return null;

  return (
    <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.05] p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-200">
        <FileText className="h-3 w-3" />
        Documents
      </p>
      <ul className="space-y-2">
        {pending.map((doc) => (
          <li
            key={doc.versionId}
            className="flex items-center justify-between gap-2 text-sm"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{doc.title}</p>
              <p className="text-xs text-muted-foreground">
                {doc.isResign ? "Updated — re-sign needed" : "Awaiting signature"}
              </p>
            </div>
            {member.isMinor ? (
              <Button size="sm" onClick={() => setSigning(doc)}>
                Sign for {member.dependent.name.split(" ")[0]}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  toast.info(
                    `Ask ${member.dependent.name.split(" ")[0]} to sign in and sign this themselves.`
                  )
                }
              >
                Send to {member.dependent.name.split(" ")[0]}
              </Button>
            )}
          </li>
        ))}
      </ul>

      {signing && (
        <SignOnBehalfDialog
          open={!!signing}
          onOpenChange={(o) => !o && setSigning(null)}
          communityId={member.communityId}
          documentVersionId={signing.versionId}
          documentTitle={signing.title}
          bodyMarkdown={signing.bodyMarkdown}
          minorName={member.dependent.name}
          minorUserId={member.dependent.id}
          guardianName={guardianName}
          onSigned={() => setSigning(null)}
        />
      )}
    </div>
  );
}
