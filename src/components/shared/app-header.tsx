"use client";

import { useState } from "react";
import Image from "next/image";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const mockCommunities = [
  { id: "1", name: "ShredTrack HQ" },
  { id: "2", name: "CFD" },
];

export function AppHeader() {
  const [activeCommunity, setActiveCommunity] = useState(mockCommunities[0]);

  return (
    <header className="sticky top-0 z-40 glass border-b border-white/[0.06]">
      {/* Safe area spacer for iOS */}
      <div className="h-[env(safe-area-inset-top)]" />
      <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
        {/* Logo / brand */}
        <div className="flex items-center gap-2.5">
          <Image
            src="/shredtrack_logo.png"
            alt="ShredTrack"
            width={64}
            height={64}
            className="h-16 w-16 rounded-lg"
            priority
          />
          <span className="font-heading text-lg font-bold uppercase tracking-wide text-gradient-primary">
            ShredTrack
          </span>
        </div>

        {/* Community switcher */}
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.04] px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground focus:outline-none">
            {activeCommunity.name}
            <ChevronDown className="h-3.5 w-3.5 opacity-50" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Your Communities
              </DropdownMenuLabel>
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
