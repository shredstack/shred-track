"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useGymContext } from "@/hooks/useGymContext";
import { GymBrandingForm } from "@/components/gym/gym-branding-form";

interface GymDetail {
  id: string;
  name: string;
  joinCode: string | null;
}

function useGymDetail(communityId: string | null) {
  return useQuery<GymDetail>({
    queryKey: ["gym-detail", communityId],
    enabled: !!communityId,
    queryFn: async () => {
      const res = await fetch(`/api/communities/${communityId}`);
      if (!res.ok) throw new Error("Failed to fetch gym");
      return res.json();
    },
  });
}

export default function GymSettingsPage() {
  const { data: ctx } = useGymContext();
  const communityId = ctx?.activeCommunityId ?? null;
  const { data: gym } = useGymDetail(communityId);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    if (gym) setName(gym.name);
  }, [gym]);

  async function save() {
    if (!communityId || !name.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/communities/${communityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to save");
      }
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["gym-detail", communityId] });
      qc.invalidateQueries({ queryKey: ["gym-context"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Gym settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="gym-name" className="text-xs">
              Gym name
            </Label>
            <Input
              id="gym-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button onClick={save} disabled={submitting || !name.trim()}>
            {submitting && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Save changes
          </Button>
        </CardContent>
      </Card>

      {communityId ? <GymBrandingForm communityId={communityId} /> : null}
    </div>
  );
}
