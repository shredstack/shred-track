// /gym/family — coach + admin read-only family directory (spec §2.2).
//
// Member-mode users land here from coach-mode or via a direct link;
// they're gated by canProgramForGym which covers coach OR admin. The
// page is intentionally read-only — there's a hard cut against admin
// edits of family links in v1 (spec §2.2).

"use client";

import { Loader2, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useGymContext } from "@/hooks/useGymContext";
import { GymToolHeader } from "@/components/gym/gym-tool-header";

interface GymFamilyView {
  accountHolder: { id: string; name: string; email: string };
  dependents: Array<{
    familyMemberId: string;
    relationship: string;
    hasOwnLogin: boolean;
    notes: string | null;
    dependent: {
      id: string;
      name: string;
      email: string;
      isShadow: boolean;
      dateOfBirth: string | null;
    };
    age: number | null;
    isMinor: boolean;
    isShadowEmail: boolean;
    pendingDocCount: number;
  }>;
}

export default function GymFamilyPage() {
  const { data: ctx } = useGymContext();
  const communityId = ctx?.activeCommunityId ?? null;

  const { data, isLoading } = useQuery<{ families: GymFamilyView[] }>({
    queryKey: ["gym", "family", communityId],
    queryFn: async () => {
      const res = await fetch(`/api/gym/${communityId}/family`);
      if (!res.ok) throw new Error("Failed to load families");
      return res.json();
    },
    enabled: !!communityId,
  });

  const families = data?.families ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <GymToolHeader
        icon={Users}
        label="Family directory"
        description="Account holders and their dependents at this gym."
      />

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : families.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No family memberships yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {families.map((f) => (
            <Card key={f.accountHolder.id}>
              <CardHeader>
                <CardTitle className="text-base font-semibold">
                  {f.accountHolder.name}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {f.accountHolder.email}
                </p>
              </CardHeader>
              <CardContent className="space-y-2">
                {f.dependents.map((d) => (
                  <div
                    key={d.familyMemberId}
                    className="rounded-lg border border-border bg-card/50 p-3"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-medium">{d.dependent.name}</p>
                      <span className="text-xs text-muted-foreground">
                        {capitalize(d.relationship)}
                        {d.age != null && ` · ${d.age}`}
                        {d.isMinor && " · Minor"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {d.dependent.isShadow ? "No login" : "Has own login"}
                      {!d.isShadowEmail && d.dependent.email && (
                        <> · {d.dependent.email}</>
                      )}
                    </p>
                    {d.pendingDocCount > 0 && (
                      <p className="mt-1 inline-block rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300">
                        {d.pendingDocCount} waiver
                        {d.pendingDocCount > 1 ? "s" : ""} missing
                      </p>
                    )}
                    {d.notes && (
                      <p className="mt-2 rounded bg-muted/40 px-2 py-1 text-xs">
                        {d.notes}
                      </p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
