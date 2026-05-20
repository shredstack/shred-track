// Single dependent card. Shows name, relationship, age + minor pill,
// login status, and an actions menu (edit / remove / send invite).
//
// Used on /profile/family. The card is purposely self-contained — it
// owns no fetching, just calls handlers that the page wires up.

"use client";

import { useState } from "react";
import { MoreVertical, Pencil, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { FamilyMemberDTO } from "@/hooks/useFamily";

interface FamilyMemberCardProps {
  member: FamilyMemberDTO;
  onEdit: (member: FamilyMemberDTO) => void;
  onRemove: (member: FamilyMemberDTO) => void;
  onSendInvite: (member: FamilyMemberDTO) => void;
  busy?: boolean;
}

const RELATIONSHIP_LABELS: Record<FamilyMemberDTO["relationship"], string> = {
  spouse: "Spouse",
  partner: "Partner",
  child: "Child",
  parent: "Parent",
  sibling: "Sibling",
  other: "Other",
};

export function FamilyMemberCard({
  member,
  onEdit,
  onRemove,
  onSendInvite,
  busy,
}: FamilyMemberCardProps) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const initials = getInitials(member.dependent.name);

  const canInvite =
    member.dependent.isShadow &&
    member.hasOwnLogin === false &&
    !member.isShadowEmail;

  return (
    <div className="rounded-xl border border-border bg-card/50 p-4">
      <div className="flex items-start gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold ${
            member.dependent.isShadow
              ? "ring-1 ring-muted-foreground/30"
              : ""
          }`}
          aria-label={
            member.dependent.isShadow
              ? "Shadow account (logged on their behalf)"
              : undefined
          }
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold">{member.dependent.name}</p>
            {member.isMinor && (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300">
                Minor
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {RELATIONSHIP_LABELS[member.relationship]}
            {member.age != null && ` · ${member.age}`}
            {member.dependent.isShadow ? " · No login" : " · Logs in"}
          </p>
          {!member.isShadowEmail && member.dependent.email && (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {member.dependent.email}
            </p>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                aria-label="Actions"
              />
            }
          >
            <MoreVertical className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onEdit(member)}>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </DropdownMenuItem>
            {canInvite && (
              <DropdownMenuItem
                onSelect={() => onSendInvite(member)}
                disabled={busy}
              >
                <Send className="mr-2 h-4 w-4" /> Send sign-in invite
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onSelect={() => setConfirmRemove(true)}
              className="text-red-400 focus:text-red-300"
            >
              <Trash2 className="mr-2 h-4 w-4" /> Remove from account
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {confirmRemove && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/[0.05] p-3 text-sm">
          <p className="mb-3 text-foreground">
            Remove <strong>{member.dependent.name}</strong> from your account?
            They&apos;ll lose access to {member.dependent.isShadow ? "the" : "the"}{" "}
            gym&apos;s programming
            {member.dependent.isShadow ? "" : " until they rejoin"}.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirmRemove(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                setConfirmRemove(false);
                onRemove(member);
              }}
            >
              Remove
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? "?";
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
