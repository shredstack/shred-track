"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, RefreshCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useGymContext, useActiveMembership } from "@/hooks/useGymContext";

export default function GymJoinCodePage() {
  const { data: ctx } = useGymContext();
  const membership = useActiveMembership();
  const qc = useQueryClient();
  const [customCode, setCustomCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!ctx?.activeCommunityId || !membership) return null;
  const communityId = ctx.activeCommunityId;
  const currentCode = membership.joinCode;

  async function rotate(opts: { custom?: boolean }) {
    setSubmitting(true);
    try {
      const body = opts.custom
        ? { customCode: customCode.trim().toUpperCase() }
        : {};
      const res = await fetch(
        `/api/communities/${communityId}/rotate-code`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to rotate code");
      toast.success(`New code: ${data.joinCode}`);
      setCustomCode("");
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
            Join code
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <p className="text-xs text-muted-foreground">Current code</p>
            <p className="font-mono text-2xl font-bold tracking-widest">
              {currentCode ?? "—"}
            </p>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Members enter this code from the gym dropdown or their profile
            settings to join. Rotating invalidates the previous code
            immediately.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Rotate code
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            onClick={() => rotate({ custom: false })}
            disabled={submitting}
            className="w-full gap-1.5"
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCcw className="h-3.5 w-3.5" />
            )}
            Generate random code
          </Button>
          <div className="space-y-2">
            <Label htmlFor="custom-code" className="text-xs">
              Or set a custom code
            </Label>
            <Input
              id="custom-code"
              value={customCode}
              onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
              placeholder="e.g. CFD2026"
              autoComplete="off"
            />
            <p className="text-[11px] text-muted-foreground">
              4-16 characters, A-Z and 0-9 only.
            </p>
            <Button
              variant="outline"
              onClick={() => rotate({ custom: true })}
              disabled={submitting || customCode.trim().length < 4}
              className="w-full"
            >
              Set custom code
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
