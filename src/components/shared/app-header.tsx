"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { Bell, ChevronDown, Plus, User as UserIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useGymContext,
  useSetActiveCommunity,
  type GymMembership,
} from "@/hooks/useGymContext";
import { JoinGymDialog } from "@/components/shared/join-gym-dialog";
import { useUnreadNotificationCount } from "@/hooks/useNotifications";

const PERSONAL_LABEL = "Personal";

function activeLabel(
  activeId: string | null,
  memberships: GymMembership[] | undefined
): string {
  if (!activeId) return PERSONAL_LABEL;
  const m = memberships?.find((x) => x.communityId === activeId);
  return m?.communityName ?? PERSONAL_LABEL;
}

export function AppHeader() {
  const { data, isLoading } = useGymContext();
  const setActive = useSetActiveCommunity();
  const [joinOpen, setJoinOpen] = useState(false);
  const { data: unread } = useUnreadNotificationCount();
  const unreadCount = unread?.count ?? 0;

  const memberships = data?.memberships.filter((m) => m.isActive) ?? [];
  const label = isLoading ? PERSONAL_LABEL : activeLabel(data?.activeCommunityId ?? null, memberships);

  return (
    <header className="sticky top-0 z-40 glass border-b border-white/[0.06]">
      {/* Safe area spacer for iOS */}
      <div className="h-[env(safe-area-inset-top)]" />
      <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
        {/* Logo / brand */}
        <Link href="/crossfit" className="flex items-center gap-2.5">
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
        </Link>

        <div className="flex items-center gap-2">
        {/* Notification bell */}
        <Link
          href="/notifications"
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.04] text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
          aria-label={
            unreadCount > 0
              ? `Notifications, ${unreadCount} unread`
              : "Notifications"
          }
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Link>

        {/* Gym switcher — falls back to "Personal" when the user has no
            gyms or hasn't picked one yet. Members can join a gym by code
            via the dialog at the bottom of the menu. */}
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.04] px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground focus:outline-none">
            {label}
            <ChevronDown className="h-3.5 w-3.5 opacity-50" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Workout view
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setActive.mutate(null)}
                className={
                  data?.activeCommunityId == null
                    ? "font-semibold text-primary"
                    : ""
                }
              >
                <UserIcon className="mr-2 h-3.5 w-3.5" />
                Personal
              </DropdownMenuItem>
            </DropdownMenuGroup>

            {memberships.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    Your gyms
                  </DropdownMenuLabel>
                  {memberships.map((m) => (
                    <DropdownMenuItem
                      key={m.communityId}
                      onClick={() => setActive.mutate(m.communityId)}
                      className={
                        m.communityId === data?.activeCommunityId
                          ? "font-semibold text-primary"
                          : ""
                      }
                    >
                      <span className="flex-1">{m.communityName}</span>
                      {(m.isAdmin || m.isCoach) && (
                        <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
                          {m.isAdmin ? "Admin" : "Coach"}
                        </span>
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </>
            )}

            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setJoinOpen(true)}>
              <Plus className="mr-2 h-3.5 w-3.5" />
              Join a gym (code)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>

      <JoinGymDialog open={joinOpen} onOpenChange={setJoinOpen} />
    </header>
  );
}
