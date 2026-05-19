"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface GymBranding {
  id: string;
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
  websiteUrl: string | null;
  inviteUrlSlug: string | null;
  autoJoinViaLink: boolean;
  gymTimezone: string;
}

function useGymBranding(communityId: string) {
  return useQuery<GymBranding>({
    queryKey: ["gym-branding", communityId],
    queryFn: async () => {
      const res = await fetch(`/api/gym/${communityId}/branding`);
      if (!res.ok) throw new Error("Failed to load branding");
      return res.json();
    },
  });
}

export function GymBrandingForm({ communityId }: { communityId: string }) {
  const { data, isLoading } = useGymBranding(communityId);
  const qc = useQueryClient();

  const [primaryColor, setPrimaryColor] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [inviteUrlSlug, setInviteUrlSlug] = useState("");
  const [autoJoinViaLink, setAutoJoinViaLink] = useState(false);
  const [gymTimezone, setGymTimezone] = useState("America/Denver");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setPrimaryColor(data.primaryColor ?? "");
    setWebsiteUrl(data.websiteUrl ?? "");
    setInviteUrlSlug(data.inviteUrlSlug ?? "");
    setAutoJoinViaLink(data.autoJoinViaLink);
    setGymTimezone(data.gymTimezone);
    setLogoUrl(data.logoUrl);
  }, [data]);

  async function uploadLogo(file: File) {
    setUploadingLogo(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
      const signRes = await fetch(`/api/gym/${communityId}/branding/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "logo", ext }),
      });
      if (!signRes.ok) {
        const body = await signRes.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to get upload URL");
      }
      const signed = (await signRes.json()) as {
        signedUrl: string;
        publicUrl: string;
      };

      const putRes = await fetch(signed.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "image/png" },
        body: file,
      });
      if (!putRes.ok) throw new Error("Upload failed");
      setLogoUrl(signed.publicUrl);
      toast.success("Logo uploaded. Click Save to persist.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingLogo(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/gym/${communityId}/branding`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logoUrl,
          primaryColor: primaryColor || null,
          websiteUrl: websiteUrl || null,
          inviteUrlSlug: inviteUrlSlug || null,
          autoJoinViaLink,
          gymTimezone,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to save");
      }
      toast.success("Branding saved");
      qc.invalidateQueries({ queryKey: ["gym-branding", communityId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading || !data) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Branding
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label className="text-xs">Logo</Label>
          <div className="flex items-center gap-3">
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt="Gym logo"
                width={64}
                height={64}
                className="h-16 w-16 rounded-lg object-contain bg-muted/30"
                unoptimized
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted/30 text-xs text-muted-foreground">
                None
              </div>
            )}
            <label className="cursor-pointer rounded-md border border-input bg-background px-3 py-2 text-xs">
              {uploadingLogo ? "Uploading…" : "Choose file…"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                disabled={uploadingLogo}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadLogo(f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="primary-color" className="text-xs">
            Primary color (hex, e.g. #1A8B7E)
          </Label>
          <Input
            id="primary-color"
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
            placeholder="#1A8B7E"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="website-url" className="text-xs">
            Website URL
          </Label>
          <Input
            id="website-url"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://crossfitdraper.com"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="invite-slug" className="text-xs">
            Invite URL slug (shredtrack.app/g/&lt;slug&gt;)
          </Label>
          <Input
            id="invite-slug"
            value={inviteUrlSlug}
            onChange={(e) =>
              setInviteUrlSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
            }
            placeholder="cfd"
          />
        </div>

        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/10 px-3 py-2">
          <div>
            <div className="text-sm">Auto-join via invite link</div>
            <div className="text-xs text-muted-foreground">
              Members hitting /g/&lt;slug&gt; are auto-added without a join code.
            </div>
          </div>
          <Switch
            checked={autoJoinViaLink}
            onCheckedChange={setAutoJoinViaLink}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="gym-timezone" className="text-xs">
            Gym timezone (IANA, e.g. America/Denver)
          </Label>
          <Input
            id="gym-timezone"
            value={gymTimezone}
            onChange={(e) => setGymTimezone(e.target.value)}
          />
        </div>

        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          Save branding
        </Button>
      </CardContent>
    </Card>
  );
}
