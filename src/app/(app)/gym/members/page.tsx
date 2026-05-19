"use client";

import { Loader2, ShieldCheck, Star, UserMinus, UserPlus, Users } from "lucide-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useGymContext } from "@/hooks/useGymContext";
import { useGymMembers } from "@/hooks/useGymMembers";
import { GymToolHeader } from "@/components/gym/gym-tool-header";

export default function GymMembersPage() {
  const { data: ctx } = useGymContext();
  const communityId = ctx?.activeCommunityId ?? null;
  const { data: members = [], isLoading } = useGymMembers(communityId);
  const qc = useQueryClient();

  const setRole = useMutation({
    mutationFn: async ({
      userId,
      isAdmin,
      isCoach,
    }: {
      userId: string;
      isAdmin?: boolean;
      isCoach?: boolean;
    }) => {
      const res = await fetch(
        `/api/communities/${communityId}/members/${userId}/role`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isAdmin, isCoach }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to update role");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gym-members", communityId] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const setActive = useMutation({
    mutationFn: async ({
      userId,
      isActive,
    }: {
      userId: string;
      isActive: boolean;
    }) => {
      const res = await fetch(
        `/api/communities/${communityId}/members/${userId}/active`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to update status");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gym-members", communityId] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed"),
  });

  if (!communityId) return null;

  const sorted = [...members].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-4">
      <GymToolHeader
        icon={Users}
        label="Members"
        description="Promote coaches and admins, deactivate former members"
      />
      <Card>
      <CardHeader>
        <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Members
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : sorted.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No members yet. Share your join code to invite athletes.
          </p>
        ) : (
          sorted.map((m) => (
            <div
              key={m.membershipId}
              className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {m.email}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {m.isAdmin && (
                    <Badge variant="secondary" className="gap-1 text-[10px]">
                      <ShieldCheck className="h-3 w-3" />
                      Admin
                    </Badge>
                  )}
                  {m.isCoach && (
                    <Badge variant="secondary" className="gap-1 text-[10px]">
                      <Star className="h-3 w-3" />
                      Coach
                    </Badge>
                  )}
                  {!m.isActive && (
                    <Badge variant="destructive" className="text-[10px]">
                      Inactive
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant={m.isCoach ? "secondary" : "outline"}
                  onClick={() =>
                    setRole.mutate({ userId: m.userId, isCoach: !m.isCoach })
                  }
                  disabled={setRole.isPending}
                  className="text-[11px]"
                >
                  {m.isCoach ? "Remove coach" : "Make coach"}
                </Button>
                <Button
                  size="sm"
                  variant={m.isAdmin ? "secondary" : "outline"}
                  onClick={() =>
                    setRole.mutate({ userId: m.userId, isAdmin: !m.isAdmin })
                  }
                  disabled={setRole.isPending}
                  className="text-[11px]"
                >
                  {m.isAdmin ? "Remove admin" : "Make admin"}
                </Button>
                <Button
                  size="sm"
                  variant={m.isActive ? "outline" : "default"}
                  onClick={() =>
                    setActive.mutate({
                      userId: m.userId,
                      isActive: !m.isActive,
                    })
                  }
                  disabled={setActive.isPending}
                  className="text-[11px]"
                >
                  {m.isActive ? (
                    <>
                      <UserMinus className="mr-1 h-3 w-3" />
                      Deactivate
                    </>
                  ) : (
                    <>
                      <UserPlus className="mr-1 h-3 w-3" />
                      Reactivate
                    </>
                  )}
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
      </Card>
    </div>
  );
}
