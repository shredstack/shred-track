"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Gym {
  id: string;
  name: string;
  joinCode: string;
  createdAt: string;
  memberCount: number;
  activeMemberCount: number;
  adminCount: number;
}

function useGyms() {
  return useQuery<Gym[]>({
    queryKey: ["admin", "gyms"],
    queryFn: async () => {
      const res = await fetch("/api/admin/gyms");
      if (!res.ok) throw new Error("Failed to fetch gyms");
      return res.json();
    },
  });
}

export default function AdminGymsPage() {
  const { data: gyms = [], isLoading } = useGyms();
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [newCustomCode, setNewCustomCode] = useState("");
  const [creating, setCreating] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [adminEmailByGym, setAdminEmailByGym] = useState<Record<string, string>>({});

  async function createGym() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/admin/gyms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          adminEmail: newAdminEmail.trim() || undefined,
          customCode: newCustomCode.trim().toUpperCase() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to create");
      }
      toast.success("Gym created");
      setNewName("");
      setNewAdminEmail("");
      setNewCustomCode("");
      qc.invalidateQueries({ queryKey: ["admin", "gyms"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setCreating(false);
    }
  }

  async function addAdminToGym(gymId: string) {
    const email = (adminEmailByGym[gymId] ?? "").trim().toLowerCase();
    if (!email) return;
    try {
      const res = await fetch(`/api/admin/gyms/${gymId}/admins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to add admin");
      }
      toast.success(`${email} is now an admin`);
      setAdminEmailByGym((prev) => ({ ...prev, [gymId]: "" }));
      qc.invalidateQueries({ queryKey: ["admin", "gyms"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Gyms</h1>
        <p className="text-sm text-muted-foreground">
          Create gyms, view membership counts, assign gym admins.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Create gym
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-name" className="text-xs">
              Gym name
            </Label>
            <Input
              id="new-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. CrossFit Downtown"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-admin-email" className="text-xs">
              Initial admin email (optional)
            </Label>
            <Input
              id="new-admin-email"
              value={newAdminEmail}
              onChange={(e) => setNewAdminEmail(e.target.value)}
              placeholder="coach@gym.com"
              type="email"
            />
            <p className="text-[11px] text-muted-foreground">
              You&apos;ll always be added as an admin so the gym is
              manageable. Setting this also makes the named user an admin.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-code" className="text-xs">
              Custom join code (optional)
            </Label>
            <Input
              id="new-code"
              value={newCustomCode}
              onChange={(e) => setNewCustomCode(e.target.value.toUpperCase())}
              placeholder="e.g. CFD2026"
            />
          </div>
          <Button
            onClick={createGym}
            disabled={creating || !newName.trim()}
            className="gap-1.5"
          >
            {creating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            Create gym
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            All gyms
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : gyms.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No gyms yet. Create your first one above.
            </p>
          ) : (
            gyms.map((g) => (
              <div
                key={g.id}
                className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{g.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {g.activeMemberCount}/{g.memberCount} active members •{" "}
                      {g.adminCount} admin{g.adminCount === 1 ? "" : "s"} • code{" "}
                      <span className="font-mono">{g.joinCode}</span>
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setExpandedId(expandedId === g.id ? null : g.id)
                    }
                  >
                    {expandedId === g.id ? "Close" : "Manage admins"}
                  </Button>
                </div>
                {expandedId === g.id && (
                  <div className="mt-3 flex items-center gap-2">
                    <Input
                      placeholder="email@gym.com"
                      value={adminEmailByGym[g.id] ?? ""}
                      onChange={(e) =>
                        setAdminEmailByGym((prev) => ({
                          ...prev,
                          [g.id]: e.target.value,
                        }))
                      }
                      className="flex-1"
                    />
                    <Button
                      size="sm"
                      onClick={() => addAdminToGym(g.id)}
                      disabled={!(adminEmailByGym[g.id] ?? "").trim()}
                      className="gap-1.5"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      Add admin
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
