"use client";

import { useState } from "react";
import { ChevronDown, Dumbbell } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

const mockCommunities = [
  { id: "1", name: "ShredTrack HQ" },
  { id: "2", name: "HYROX Chicago" },
  { id: "3", name: "CrossFit 312" },
];

export function AppHeader() {
  const [activeCommunity, setActiveCommunity] = useState(mockCommunities[0]);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-xl">
      {/* Safe area spacer for iOS */}
      <div className="h-[env(safe-area-inset-top)]" />
      <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
        {/* Logo / brand */}
        <div className="flex items-center gap-2">
          <Dumbbell className="h-5 w-5 text-primary" />
          <span className="text-lg font-bold tracking-tight">ShredTrack</span>
        </div>

        {/* Community switcher */}
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground focus:outline-none">
              {activeCommunity.name}
              <ChevronDown className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Your Communities</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {mockCommunities.map((community) => (
                <DropdownMenuItem
                  key={community.id}
                  onClick={() => setActiveCommunity(community)}
                  className={
                    community.id === activeCommunity.id
                      ? "font-semibold text-primary"
                      : ""
                  }
                >
                  {community.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
