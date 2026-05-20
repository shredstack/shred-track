// Profile-page section shown to users who are *dependents* of an
// account holder (spec §9.2). Lets them leave the family relationship
// themselves without involving the account holder.
//
// Hidden when the user is not anyone's dependent.

"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface DependentLink {
  familyMemberId: string;
  relationship: string;
  communityId: string;
  communityName: string;
  accountHolderId: string;
  accountHolderName: string;
}

export function FamilyLinksSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ asDependent: DependentLink[] }>({
    queryKey: ["family", "me"],
    queryFn: async () => {
      const res = await fetch("/api/family/me");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });
  const [confirming, setConfirming] = useState<string | null>(null);

  const leaveMutation = useMutation({
    mutationFn: async (familyMemberId: string) => {
      const res = await fetch("/api/family/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ familyMemberId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Failed");
      return body;
    },
    onSuccess: () => {
      toast.success("You've left the account.");
      qc.invalidateQueries({ queryKey: ["family", "me"] });
      qc.invalidateQueries({ queryKey: ["gym-context"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return null;
  const links = data?.asDependent ?? [];
  if (links.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Family link
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {links.map((link) => (
          <div
            key={link.familyMemberId}
            className="rounded-lg border border-border bg-muted/30 p-3"
          >
            <p className="text-sm">
              <strong>{link.accountHolderName}</strong> manages your membership
              at <strong>{link.communityName}</strong>.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Your scores, login, and personal history stay yours. Leaving
              ends the gym relationship at that gym.
            </p>
            {confirming === link.familyMemberId ? (
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirming(null)}
                  disabled={leaveMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => leaveMutation.mutate(link.familyMemberId)}
                  disabled={leaveMutation.isPending}
                >
                  Leave {link.accountHolderName.split(" ")[0]}&apos;s account
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="mt-3"
                onClick={() => setConfirming(link.familyMemberId)}
              >
                Leave {link.accountHolderName.split(" ")[0]}&apos;s account
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
