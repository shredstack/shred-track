import Link from "next/link";
import { FileSignature, ChevronRight } from "lucide-react";

export interface PendingDocumentsBannerData {
  // Pre-resolved gym invite slug so the banner can deep-link straight to
  // the sign flow. Falls back to /home if missing (shouldn't happen for
  // a properly-branded gym).
  slug: string;
  gymName: string;
  pendingCount: number;
  // True if the user has signed at least one of the documents in the
  // queue before (i.e. they're being asked to re-sign because a new
  // version was published).
  anyResign: boolean;
}

export function PendingDocumentsBanner({
  data,
}: {
  data: PendingDocumentsBannerData | null;
}) {
  if (!data || data.pendingCount === 0) return null;

  const label = data.anyResign
    ? `${data.gymName} updated a document. Please review and re-sign.`
    : `${data.gymName} needs you to sign ${
        data.pendingCount === 1
          ? "1 document"
          : `${data.pendingCount} documents`
      } to finish joining.`;

  return (
    <Link
      href={`/g/${data.slug}/sign-documents`}
      className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-3 py-2.5"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15">
        <FileSignature className="h-4 w-4 text-amber-500" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-[11px] text-muted-foreground">
          Tap to open the sign flow.
        </p>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </Link>
  );
}
