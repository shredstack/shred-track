"use client";

import { useRouter } from "next/navigation";
import { LogOut, Settings, Award, BarChart3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
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
      <div className="flex items-center gap-4">
        <Avatar className="h-16 w-16">
          <AvatarFallback className="bg-primary/10 text-lg font-bold text-primary">
            ST
          </AvatarFallback>
        </Avatar>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Athlete</h1>
          <p className="text-sm text-muted-foreground">ShredTrack Member</p>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="flex flex-col items-center py-4">
            <span className="text-2xl font-bold tabular-nums">0</span>
            <span className="text-xs text-muted-foreground">Workouts</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col items-center py-4">
            <span className="text-2xl font-bold tabular-nums">0</span>
            <span className="text-xs text-muted-foreground">This Week</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col items-center py-4">
            <span className="text-2xl font-bold tabular-nums">0</span>
            <span className="text-xs text-muted-foreground">Streak</span>
          </CardContent>
        </Card>
      </div>

      {/* Menu items */}
      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-base">Account</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col pt-3">
          <button className="flex items-center gap-3 rounded-md px-1 py-3 text-sm transition-colors hover:bg-accent">
            <Settings className="h-4 w-4 text-muted-foreground" />
            <span>Settings</span>
          </button>
          <Separator />
          <button className="flex items-center gap-3 rounded-md px-1 py-3 text-sm transition-colors hover:bg-accent">
            <Award className="h-4 w-4 text-muted-foreground" />
            <span>Achievements</span>
          </button>
          <Separator />
          <button className="flex items-center gap-3 rounded-md px-1 py-3 text-sm transition-colors hover:bg-accent">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            <span>Personal Records</span>
          </button>
          <Separator />
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 rounded-md px-1 py-3 text-sm text-destructive transition-colors hover:bg-accent"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign Out</span>
          </button>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        ShredTrack v0.1.0
      </p>
    </div>
  );
}
