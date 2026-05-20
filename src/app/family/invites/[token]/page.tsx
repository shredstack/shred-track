"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface InviteInfo {
  relationship?: string;
  expiresAt?: string;
  expired?: boolean;
  responded?: boolean;
  response?: "accepted" | "declined" | null;
  accountHolderName?: string;
  communityName?: string;
  error?: string;
}

export default function FamilyInviteConsentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const router = useRouter();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<"accepted" | "declined" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/family/invites/${token}`)
      .then((r) => r.json())
      .then((d) => !cancelled && setInfo(d))
      .catch(() => !cancelled && setError("Invite link is invalid."));
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function respond(action: "accept" | "decline") {
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/family/invites/${token}/${action}`, {
      method: "POST",
    });
    const data = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      if (res.status === 401) {
        // Push them through sign-in, then back here.
        router.push(
          `/auth?next=${encodeURIComponent(`/family/invites/${token}`)}`
        );
        return;
      }
      setError(data?.error || "Something went wrong.");
      return;
    }
    setDone(action === "accept" ? "accepted" : "declined");
  }

  if (!info && !error) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 bg-mesh">
      <div className="w-full max-w-sm rounded-2xl bg-card/80 p-6 backdrop-blur-sm gradient-border">
        {done === "accepted" ? (
          <div className="flex flex-col items-center gap-4 py-4">
            <CheckCircle className="h-10 w-10 text-emerald-400" />
            <h2 className="text-lg font-semibold">Accepted</h2>
            <p className="text-center text-sm text-muted-foreground">
              You&apos;re now linked under {info?.accountHolderName}&apos;s
              family at {info?.communityName}.
            </p>
            <Button onClick={() => router.push("/home")}>Go to ShredTrack</Button>
          </div>
        ) : done === "declined" ? (
          <div className="flex flex-col items-center gap-4 py-4">
            <X className="h-10 w-10 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Declined</h2>
            <p className="text-center text-sm text-muted-foreground">
              No changes were made to your account.
            </p>
          </div>
        ) : info?.responded ? (
          <ResponseInfo response={info.response} />
        ) : info?.expired ? (
          <ExpiredInfo />
        ) : (
          <>
            <h2 className="mb-2 text-center text-lg font-semibold">
              {info?.accountHolderName} wants to add you as family
            </h2>
            <p className="mb-4 text-center text-sm text-muted-foreground">
              They added you as their <strong>{info?.relationship}</strong> at{" "}
              <strong>{info?.communityName}</strong>. Accepting links your
              account so they can manage your gym membership; your scores,
              login, and history stay yours.
            </p>
            {error && (
              <p className="mb-2 text-center text-sm text-red-400">{error}</p>
            )}
            <div className="flex flex-col gap-2">
              <Button
                onClick={() => respond("accept")}
                disabled={submitting}
              >
                Accept
              </Button>
              <Button
                variant="outline"
                onClick={() => respond("decline")}
                disabled={submitting}
              >
                Decline
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ExpiredInfo() {
  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <h2 className="text-lg font-semibold">This invite has expired</h2>
      <p className="text-center text-sm text-muted-foreground">
        Ask the person who added you to send a fresh invite.
      </p>
    </div>
  );
}

function ResponseInfo({ response }: { response?: "accepted" | "declined" | null }) {
  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <h2 className="text-lg font-semibold">Already {response ?? "responded"}</h2>
      <p className="text-center text-sm text-muted-foreground">
        This invite was {response} previously. No further action is needed.
      </p>
    </div>
  );
}
