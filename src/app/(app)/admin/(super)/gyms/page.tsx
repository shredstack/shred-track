"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Building2,
  Loader2,
  Plus,
  ShieldCheck,
  Star,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AdminToolHeader } from "@/components/admin/admin-tool-header";

interface Gym {
  id: string;
  name: string;
  joinCode: string;
  createdAt: string;
  memberCount: number;
  activeMemberCount: number;
  adminCount: number;
}

interface GymMember {
  membershipId: string;
  userId: string;
  isAdmin: boolean;
  isCoach: boolean;
  isActive: boolean;
  name: string;
  email: string;
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

function useGymStaff(gymId: string | null) {
  return useQuery<GymMember[]>({
    queryKey: ["admin", "gym-staff", gymId],
    enabled: !!gymId,
    queryFn: async () => {
      const res = await fetch(`/api/communities/${gymId}/members`);
      if (!res.ok) throw new Error("Failed to load members");
      const rows = (await res.json()) as GymMember[];
      return rows.filter((r) => r.isAdmin || r.isCoach);
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
      qc.invalidateQueries({ queryKey: ["admin", "gym-staff", gymId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  async function setRole(
    gymId: string,
    userId: string,
    updates: { isAdmin?: boolean; isCoach?: boolean }
  ) {
    try {
      const res = await fetch(
        `/api/communities/${gymId}/members/${userId}/role`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to update");
      }
      qc.invalidateQueries({ queryKey: ["admin", "gyms"] });
      qc.invalidateQueries({ queryKey: ["admin", "gym-staff", gymId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  async function removeStaff(gymId: string, userId: string) {
    if (
      !confirm(
        "Deactivate this person? Their roles will be cleared and they'll be marked inactive."
      )
    )
      return;
    try {
      const res = await fetch(
        `/api/communities/${gymId}/members/${userId}/remove`,
        { method: "POST" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to remove");
      }
      qc.invalidateQueries({ queryKey: ["admin", "gyms"] });
      qc.invalidateQueries({ queryKey: ["admin", "gym-staff", gymId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  return (
    <div className="space-y-4">
      <AdminToolHeader
        icon={Building2}
        label="Gyms"
        description="Create gyms, view membership counts, assign and remove gym admins or coaches."
      />

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
                    {expandedId === g.id ? "Close" : "Manage staff"}
                  </Button>
                </div>
                {expandedId === g.id && (
                  <GymStaffPanel
                    gymId={g.id}
                    addEmail={adminEmailByGym[g.id] ?? ""}
                    onChangeAddEmail={(v) =>
                      setAdminEmailByGym((prev) => ({ ...prev, [g.id]: v }))
                    }
                    onAdd={() => addAdminToGym(g.id)}
                    onToggleRole={(userId, updates) =>
                      setRole(g.id, userId, updates)
                    }
                    onRemove={(userId) => removeStaff(g.id, userId)}
                  />
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function GymStaffPanel({
  gymId,
  addEmail,
  onChangeAddEmail,
  onAdd,
  onToggleRole,
  onRemove,
}: {
  gymId: string;
  addEmail: string;
  onChangeAddEmail: (v: string) => void;
  onAdd: () => void;
  onToggleRole: (
    userId: string,
    updates: { isAdmin?: boolean; isCoach?: boolean }
  ) => void;
  onRemove: (userId: string) => void;
}) {
  const { data: staff = [], isLoading } = useGymStaff(gymId);
  return (
    <div className="mt-3 space-y-3">
      <div className="rounded-md border border-white/[0.04] bg-white/[0.02] p-2 text-[11px] text-muted-foreground">
        <p>
          <span className="font-semibold text-foreground">Admins</span> manage
          members, schedules, settings, and documents.{" "}
          <span className="font-semibold text-foreground">Coaches</span> can
          program workouts but not manage the gym. A person can be either,
          both, or neither.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-3">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : staff.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          No admins or coaches yet.
        </p>
      ) : (
        <div className="space-y-1.5">
          {staff.map((m) => (
            <div
              key={m.membershipId}
              className="flex flex-col gap-1.5 rounded-md border border-white/[0.04] bg-white/[0.01] p-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1">
                    <p className="truncate text-xs font-medium">{m.name}</p>
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
                  <p className="truncate text-[10px] text-muted-foreground">
                    {m.email}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant={m.isAdmin ? "secondary" : "outline"}
                  className="h-7 text-[11px]"
                  onClick={() =>
                    onToggleRole(m.userId, { isAdmin: !m.isAdmin })
                  }
                >
                  {m.isAdmin ? "Remove admin" : "Make admin"}
                </Button>
                <Button
                  size="sm"
                  variant={m.isCoach ? "secondary" : "outline"}
                  className="h-7 text-[11px]"
                  onClick={() =>
                    onToggleRole(m.userId, { isCoach: !m.isCoach })
                  }
                >
                  {m.isCoach ? "Remove coach" : "Make coach"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px] text-destructive hover:text-destructive"
                  onClick={() => onRemove(m.userId)}
                >
                  <UserMinus className="mr-1 h-3 w-3" />
                  Remove from gym
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Add admin
        </p>
        <div className="flex items-center gap-2">
          <Input
            placeholder="email@gym.com"
            value={addEmail}
            onChange={(e) => onChangeAddEmail(e.target.value)}
            className="flex-1"
          />
          <Button
            size="sm"
            onClick={onAdd}
            disabled={!addEmail.trim()}
            className="gap-1.5"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Add
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Adds the user as both admin and coach. Use the toggles above to
          adjust afterwards.
        </p>
      </div>
    </div>
  );
}
