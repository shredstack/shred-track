"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Trash2, Crown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface VipUser {
  id: string;
  email: string;
  name: string;
  isVip: boolean;
  updatedAt: string;
}

export function AdminUsersVip() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");

  const query = useQuery({
    queryKey: ["admin-users-vip"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users/vip");
      if (!res.ok) throw new Error("Failed to load VIP users");
      return (await res.json()) as { vips: VipUser[] };
    },
  });

  const grantMutation = useMutation({
    mutationFn: async (input: { email: string }) => {
      const res = await fetch("/api/admin/users/vip", {
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
      queryClient.invalidateQueries({ queryKey: ["admin-users-vip"] });
      setEmail("");
      toast.success("VIP granted");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const revokeMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/admin/users/vip/${userId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to revoke");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users-vip"] });
      toast.success("VIP revoked");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function submit() {
    if (!email.trim()) return toast.error("Email required");
    grantMutation.mutate({ email: email.trim() });
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardContent className="flex flex-col gap-3 py-5">
          <div className="flex items-center gap-2">
            <Crown className="h-4 w-4 text-amber-400" />
            <p className="text-sm font-semibold">Grant VIP access</p>
          </div>
          <p className="text-xs text-muted-foreground">
            VIPs get every paid feature for free, including unlimited HYROX plans
            and AI insights.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="user-vip-email" className="text-xs">Email</Label>
            <Input
              id="user-vip-email"
              type="email"
              placeholder="athlete@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button onClick={submit} disabled={grantMutation.isPending}>
            {grantMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Grant VIP
          </Button>
        </CardContent>
      </Card>

      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          Active VIPs
        </p>
        {query.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading...
          </div>
        ) : !query.data?.vips.length ? (
          <p className="text-sm text-muted-foreground">No VIP users yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {query.data.vips.map((u) => (
              <Card key={u.id}>
                <CardContent className="flex items-center justify-between gap-2 py-3">
                  <div className="flex min-w-0 flex-col">
                    <p className="text-sm font-semibold truncate">{u.name || u.email}</p>
                    <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => revokeMutation.mutate(u.id)}
                    disabled={revokeMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
