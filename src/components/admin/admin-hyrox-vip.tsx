"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Trash2, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface VipGrant {
  userId: string;
  email: string;
  name: string;
  plansPerYear: number;
  active: boolean;
  notes: string | null;
  updatedAt: string;
}

export function AdminHyroxVip() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [plansPerYear, setPlansPerYear] = useState("12");
  const [notes, setNotes] = useState("");

  const query = useQuery({
    queryKey: ["admin-hyrox-vip"],
    queryFn: async () => {
      const res = await fetch("/api/admin/hyrox/vip");
      if (!res.ok) throw new Error("Failed to load VIP grants");
      return (await res.json()) as { grants: VipGrant[] };
    },
  });

  const grantMutation = useMutation({
    mutationFn: async (input: { email: string; plansPerYear: number; notes?: string }) => {
      const res = await fetch("/api/admin/hyrox/vip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to grant VIP");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-hyrox-vip"] });
      setEmail("");
      setNotes("");
      toast.success("VIP grant saved");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const revokeMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/admin/hyrox/vip/${userId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to revoke");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-hyrox-vip"] });
      toast.success("VIP revoked");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function submit() {
    const n = Number.parseInt(plansPerYear, 10);
    if (!email.trim()) return toast.error("Email required");
    if (!Number.isInteger(n) || n < 0 || n > 100) {
      return toast.error("Plans per year must be 0–100");
    }
    grantMutation.mutate({
      email: email.trim(),
      plansPerYear: n,
      notes: notes.trim() || undefined,
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardContent className="flex flex-col gap-3 py-5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-400" />
            <p className="text-sm font-semibold">Grant VIP access</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Grants a user N free personalized plans per rolling 365 days. Entering
            an existing VIP email updates their allowance.
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vip-email" className="text-xs">Email</Label>
              <Input
                id="vip-email"
                type="email"
                placeholder="athlete@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vip-allowance" className="text-xs">Plans / year</Label>
              <Input
                id="vip-allowance"
                type="number"
                min={0}
                max={100}
                value={plansPerYear}
                onChange={(e) => setPlansPerYear(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vip-notes" className="text-xs">Notes (optional)</Label>
            <Input
              id="vip-notes"
              placeholder="Why this user is VIP"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <Button onClick={submit} disabled={grantMutation.isPending}>
            {grantMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Grant / update VIP
          </Button>
        </CardContent>
      </Card>

      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          Active grants
        </p>
        {query.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading...
          </div>
        ) : !query.data?.grants.length ? (
          <p className="text-sm text-muted-foreground">No VIP grants yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {query.data.grants.map((g) => (
              <Card key={g.userId}>
                <CardContent className="flex items-center justify-between gap-2 py-3">
                  <div className="flex min-w-0 flex-col">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold truncate">{g.name || g.email}</p>
                      {g.active ? (
                        <Badge variant="secondary" className="text-[10px]">
                          {g.plansPerYear}/yr
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">revoked</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{g.email}</p>
                    {g.notes && (
                      <p className="text-[11px] text-muted-foreground italic truncate">
                        {g.notes}
                      </p>
                    )}
                  </div>
                  {g.active && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => revokeMutation.mutate(g.userId)}
                      disabled={revokeMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
