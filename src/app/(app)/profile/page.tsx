"use client";

import { useRouter } from "next/navigation";
import { LogOut, Settings, Award, BarChart3, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { createClient } from "@/lib/supabase/client";

export default function ProfilePage() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Profile header */}
      <div className="flex flex-col items-center gap-3 pt-2">
        <Avatar className="h-20 w-20 ring-2 ring-primary/20">
          <AvatarFallback className="bg-primary/10 text-xl font-bold text-primary">
            ST
          </AvatarFallback>
        </Avatar>
        <div className="text-center">
          <h1 className="text-xl font-bold tracking-tight">Athlete</h1>
          <p className="text-sm text-muted-foreground">ShredTrack Member</p>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Workouts", value: "0" },
          { label: "This Week", value: "0" },
          { label: "Streak", value: "0" },
        ].map((stat) => (
          <Card key={stat.label} size="sm">
            <CardContent className="flex flex-col items-center gap-0.5 py-4">
              <span className="text-2xl font-bold tabular-nums font-mono">{stat.value}</span>
              <span className="text-[10px] text-muted-foreground">{stat.label}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Menu items */}
      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-sm font-bold text-muted-foreground uppercase tracking-wider">
            Account
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col pt-3">
          {[
            { icon: Settings, label: "Settings", destructive: false },
            { icon: Award, label: "Achievements", destructive: false },
            { icon: BarChart3, label: "Personal Records", destructive: false },
          ].map((item, i) => (
            <button
              key={item.label}
              className="flex items-center gap-3 rounded-lg px-2 py-3.5 text-sm transition-colors hover:bg-white/[0.04] group"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.04]">
                <item.icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <span className="flex-1 text-left">{item.label}</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />
            </button>
          ))}
          <div className="my-1 h-px bg-white/[0.04]" />
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 rounded-lg px-2 py-3.5 text-sm text-destructive transition-colors hover:bg-destructive/5 group"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive/10">
              <LogOut className="h-4 w-4" />
            </div>
            <span className="flex-1 text-left">Sign Out</span>
          </button>
        </CardContent>
      </Card>

      <p className="text-center text-[11px] text-muted-foreground/40">
        ShredTrack v0.1.0
      </p>
    </div>
  );
}
