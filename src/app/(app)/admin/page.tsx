"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminMovements } from "@/components/admin/admin-movements";
import { AdminBenchmarks } from "@/components/admin/admin-benchmarks";
import { AdminHyroxVip } from "@/components/admin/admin-hyrox-vip";
import { Dumbbell, Trophy, Sparkles } from "lucide-react";

export default function AdminPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Manage movements, benchmarks, and HYROX VIP access
        </p>
      </div>

      <Tabs defaultValue="movements">
        <TabsList className="w-full">
          <TabsTrigger value="movements" className="flex-1 gap-1.5">
            <Dumbbell className="h-3.5 w-3.5" />
            Movements
          </TabsTrigger>
          <TabsTrigger value="benchmarks" className="flex-1 gap-1.5">
            <Trophy className="h-3.5 w-3.5" />
            Benchmarks
          </TabsTrigger>
          <TabsTrigger value="hyrox-vip" className="flex-1 gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            HYROX VIP
          </TabsTrigger>
        </TabsList>
        <TabsContent value="movements" className="mt-4">
          <AdminMovements />
        </TabsContent>
        <TabsContent value="benchmarks" className="mt-4">
          <AdminBenchmarks />
        </TabsContent>
        <TabsContent value="hyrox-vip" className="mt-4">
          <AdminHyroxVip />
        </TabsContent>
      </Tabs>
    </div>
  );
}
