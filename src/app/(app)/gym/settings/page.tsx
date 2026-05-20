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
import { GymToolHeader } from "@/components/gym/gym-tool-header";
import { Settings } from "lucide-react";

interface GymDetail {
  id: string;
  name: string;
  joinCode: string | null;
  websiteUrl: string | null;
  adminEmail: string | null;
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
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    if (gym) {
      setName(gym.name);
      setWebsiteUrl(gym.websiteUrl ?? "");
      setAdminEmail(gym.adminEmail ?? "");
    }
  }, [gym]);

  async function save() {
    if (!communityId || !name.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/communities/${communityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          websiteUrl: websiteUrl.trim() || null,
          adminEmail: adminEmail.trim() || null,
        }),
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
      <GymToolHeader
        icon={Settings}
        label="Gym settings"
        description="Name, website, admin email, and branding"
      />
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
          <div className="space-y-1.5">
            <Label htmlFor="gym-website" className="text-xs">
              Website URL
            </Label>
            <Input
              id="gym-website"
              type="url"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://crossfitdraper.com"
            />
            <p className="text-[11px] text-muted-foreground">
              Shown on the home header strip and the public invite landing.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gym-admin-email" className="text-xs">
              Admin email
            </Label>
            <Input
              id="gym-admin-email"
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="owner@yourgym.com"
            />
            <p className="text-[11px] text-muted-foreground">
              Where the &ldquo;Ask the gym owner&rdquo; support form delivers.
              Falls back to admin user emails if blank.
            </p>
          </div>
          <Button onClick={save} disabled={submitting || !name.trim()}>
            {submitting && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Save changes
          </Button>
        </CardContent>
      </Card>

      {communityId ? <GymBrandingForm communityId={communityId} /> : null}
      {communityId ? <CaloriePreferencesForm communityId={communityId} /> : null}
    </div>
  );
}

interface CaloriePrefs {
  epocDefaultEnabled: boolean;
  epocMultiplier: number;
}

function CaloriePreferencesForm({ communityId }: { communityId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<CaloriePrefs>({
    queryKey: ["gym-calorie-prefs", communityId],
    queryFn: async () => {
      const res = await fetch(
        `/api/communities/${communityId}/calorie-preferences`
      );
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });
  const [enabled, setEnabled] = useState(true);
  const [multiplier, setMultiplier] = useState("1.10");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (data) {
      setEnabled(data.epocDefaultEnabled);
      setMultiplier(data.epocMultiplier.toFixed(2));
    }
  }, [data]);

  async function save() {
    const n = parseFloat(multiplier);
    if (!Number.isFinite(n) || n < 1 || n > 1.2) {
      toast.error("Multiplier must be between 1.00 and 1.20");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/communities/${communityId}/calorie-preferences`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            epocDefaultEnabled: enabled,
            epocMultiplier: n,
          }),
        }
      );
      if (!res.ok) throw new Error("Failed to save");
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["gym-calorie-prefs", communityId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Calorie estimates
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-xs">Apply EPOC by default</Label>
                <p className="text-[11px] text-muted-foreground">
                  EPOC (&ldquo;afterburn&rdquo;) adds elevated metabolism after
                  intense work. Members can override this in their profile.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEnabled((v) => !v)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  enabled
                    ? "bg-primary text-primary-foreground"
                    : "border border-white/[0.08] text-muted-foreground hover:bg-white/[0.04]"
                }`}
              >
                {enabled ? "On" : "Off"}
              </button>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="epoc-multiplier" className="text-xs">
                EPOC multiplier (1.00–1.20)
              </Label>
              <Input
                id="epoc-multiplier"
                type="number"
                step="0.01"
                min="1.00"
                max="1.20"
                value={multiplier}
                onChange={(e) => setMultiplier(e.target.value)}
                disabled={!enabled}
              />
              <p className="text-[11px] text-muted-foreground">
                Default 1.10 (+10%). HIIT literature puts EPOC at 6–15% of
                session calories.
              </p>
            </div>
            <Button onClick={save} disabled={submitting}>
              {submitting && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Save changes
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
