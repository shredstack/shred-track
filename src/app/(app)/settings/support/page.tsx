"use client";

// /settings/support — Help & Support (spec §3.5).
//
// Two forms on one page: ask the gym owner, and report a bug to
// ShredTrack. Routes to /api/support which handles delivery via Resend.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useGymContext } from "@/hooks/useGymContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Bug, Loader2, MessageSquare } from "lucide-react";
import { BackButton } from "@/components/shared/back-button";

type Variant = "gym-owner" | "bug-report";

function useSendSupport() {
  return useMutation({
    mutationFn: async (data: {
      variant: Variant;
      subject: string;
      message: string;
      recentRoute?: string;
    }) => {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to send");
      }
      return res.json();
    },
  });
}

export default function SupportPage() {
  const { data: ctx } = useGymContext();
  const activeId = ctx?.activeCommunityId ?? null;
  const activeGymName =
    ctx?.memberships.find((m) => m.communityId === activeId)?.communityName ??
    null;

  return (
    <div className="space-y-4">
      <BackButton fallbackHref="/profile" label="Profile" />
      <div>
        <h1 className="text-2xl font-bold">Help &amp; Support</h1>
        <p className="text-sm text-muted-foreground">
          Get help from your gym owner or report a bug to ShredTrack.
        </p>
      </div>

      <GymOwnerForm activeGymName={activeGymName} hasGym={!!activeId} />
      <BugReportForm />
    </div>
  );
}

function GymOwnerForm({
  activeGymName,
  hasGym,
}: {
  activeGymName: string | null;
  hasGym: boolean;
}) {
  const send = useSendSupport();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const route =
      typeof window !== "undefined" ? window.location.pathname : undefined;
    try {
      await send.mutateAsync({
        variant: "gym-owner",
        subject: subject.trim(),
        message: message.trim(),
        recentRoute: route,
      });
      toast.success("Sent");
      setSubject("");
      setMessage("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send");
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
          <MessageSquare className="h-4 w-4 text-primary" />
        </div>
        <div>
          <CardTitle className="text-sm">Ask the gym owner</CardTitle>
          <p className="text-[11px] text-muted-foreground">
            {activeGymName
              ? `Sends to ${activeGymName}'s admin email.`
              : "Join a gym to message its admin."}
          </p>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label>Subject</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Can I switch my membership to the 9am class?"
              required
              disabled={!hasGym}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Message</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              required
              disabled={!hasGym}
            />
          </div>
          <Button
            type="submit"
            disabled={
              !hasGym || !subject.trim() || !message.trim() || send.isPending
            }
          >
            {send.isPending && (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            )}
            Send to gym owner
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function BugReportForm() {
  const send = useSendSupport();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const route =
      typeof window !== "undefined" ? window.location.pathname : undefined;
    try {
      await send.mutateAsync({
        variant: "bug-report",
        subject: subject.trim(),
        message: message.trim(),
        recentRoute: route,
      });
      toast.success("Thanks — we'll take a look");
      setSubject("");
      setMessage("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send");
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15">
          <Bug className="h-4 w-4 text-amber-500" />
        </div>
        <div>
          <CardTitle className="text-sm">Report a bug to ShredTrack</CardTitle>
          <p className="text-[11px] text-muted-foreground">
            Goes directly to the ShredTrack team.
          </p>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label>Subject</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Score modal won't open"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>What went wrong?</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              placeholder="The more detail the better — what you did, what happened, what you expected."
              required
            />
          </div>
          <Button type="submit" disabled={!subject.trim() || !message.trim() || send.isPending}>
            {send.isPending && (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            )}
            Send bug report
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
