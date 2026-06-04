// Client island for /profile/family. Hydrates the server-rendered
// initial list into React Query so subsequent mutations stay in sync,
// owns the add/edit/remove/invite flows.

"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/shared/back-button";
import {
  familyQueryKey,
  useAddFamilyMember,
  useEditFamilyMember,
  useFamily,
  useRemoveFamilyMember,
  useSendActivationInvite,
  type FamilyMemberDTO,
} from "@/hooks/useFamily";
import { FamilyMemberCard } from "@/components/family/FamilyMemberCard";
import { FamilyMemberDocsSection } from "@/components/family/FamilyMemberDocsSection";
import {
  AddOrEditFamilyMemberSheet,
  type FamilyMemberFormValues,
  type FamilyMemberSheetMode,
} from "@/components/family/AddOrEditFamilyMemberSheet";

interface Props {
  communityId: string;
  accountHolderName: string;
  accountHolderEmail: string;
  initialFamily: (FamilyMemberDTO & { createdAt: string })[];
}

export function FamilyPageClient({
  communityId,
  accountHolderName,
  accountHolderEmail,
  initialFamily,
}: Props) {
  const qc = useQueryClient();

  // Hydrate the server-rendered list into the query cache so the first
  // client render is instant and subsequent mutations are correctly
  // invalidated. Per CLAUDE.md "UI Performance" guidance.
  useEffect(() => {
    qc.setQueryData(familyQueryKey(communityId), { dependents: initialFamily });
  }, [qc, communityId, initialFamily]);

  const { data, isLoading } = useFamily(communityId);
  const dependents = data?.dependents ?? initialFamily;

  const addMutation = useAddFamilyMember();
  const editMutation = useEditFamilyMember();
  const removeMutation = useRemoveFamilyMember();
  const inviteMutation = useSendActivationInvite();

  const [sheetMode, setSheetMode] = useState<FamilyMemberSheetMode>("add");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<FamilyMemberDTO | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);

  function openAdd() {
    setSheetMode("add");
    setEditing(null);
    setSheetError(null);
    setSheetOpen(true);
  }

  function openEdit(member: FamilyMemberDTO) {
    setSheetMode("edit");
    setEditing(member);
    setSheetError(null);
    setSheetOpen(true);
  }

  async function handleSubmit(values: FamilyMemberFormValues) {
    setSheetError(null);
    try {
      if (sheetMode === "add") {
        const result = await addMutation.mutateAsync({
          communityId,
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim() || undefined,
          dateOfBirth: values.dateOfBirth || undefined,
          gender: values.gender,
          relationship: values.relationship,
          email: values.email.trim() || undefined,
          hasOwnLogin: values.hasOwnLogin,
          notes: values.notes.trim() || undefined,
        });
        if (result.status === "consent_invite_sent") {
          toast.success("Consent request sent — they'll appear here once they accept.");
        } else {
          toast.success("Family member added.");
          // If hasOwnLogin was selected and we just created a shadow,
          // fire the activation invite so the dependent gets an email.
          if (values.hasOwnLogin && result.status === "shadow_created") {
            try {
              await inviteMutation.mutateAsync({
                familyMemberId: result.familyMemberId,
                communityId,
              });
              toast.success("Activation email sent.");
            } catch (err) {
              console.error("[family] auto-invite failed", err);
            }
          }
        }
        setSheetOpen(false);
      } else if (editing) {
        await editMutation.mutateAsync({
          familyMemberId: editing.familyMemberId,
          communityId,
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim() || null,
          dateOfBirth: values.dateOfBirth || null,
          gender: values.gender ?? null,
          relationship: values.relationship,
          email: editing.hasOwnLogin
            ? undefined
            : values.email.trim() || null,
          notes: values.notes.trim() || null,
        });
        toast.success("Saved.");
        setSheetOpen(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setSheetError(msg);
    }
  }

  async function handleRemove(member: FamilyMemberDTO) {
    try {
      await removeMutation.mutateAsync({
        familyMemberId: member.familyMemberId,
        communityId,
      });
      toast.success(`${member.dependent.name} removed.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to remove";
      toast.error(msg);
    }
  }

  async function handleInvite(member: FamilyMemberDTO) {
    try {
      const result = await inviteMutation.mutateAsync({
        familyMemberId: member.familyMemberId,
        communityId,
      });
      toast.success(`Invite sent to ${result.sentTo}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send invite";
      toast.error(msg);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-6 pb-24">
      <BackButton fallbackHref="/profile" label="Profile" />
      <div>
        <h1 className="text-2xl font-bold">Family</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage the family members under your account.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card/50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Your account
        </p>
        <p className="mt-2 font-semibold">{accountHolderName}</p>
        <p className="text-xs text-muted-foreground">{accountHolderEmail}</p>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Dependents
          </h2>
          <Button size="sm" variant="ghost" onClick={openAdd}>
            <Plus className="mr-1 h-4 w-4" /> Add
          </Button>
        </div>

        {dependents.length === 0 ? (
          <EmptyState onAdd={openAdd} loading={isLoading} />
        ) : (
          <div className="space-y-3">
            {dependents.map((member) => (
              <div key={member.familyMemberId}>
                <FamilyMemberCard
                  member={member}
                  onEdit={openEdit}
                  onRemove={handleRemove}
                  onSendInvite={handleInvite}
                  busy={
                    removeMutation.isPending || inviteMutation.isPending
                  }
                />
                <FamilyMemberDocsSection
                  member={member}
                  guardianName={accountHolderName}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="fixed inset-x-0 bottom-20 z-30 mx-auto max-w-md px-4 sm:bottom-6">
        <Button onClick={openAdd} className="w-full shadow-lg">
          <UserPlus className="mr-2 h-4 w-4" />
          Add a family member
        </Button>
      </div>

      <AddOrEditFamilyMemberSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        mode={sheetMode}
        initial={editing}
        onSubmit={handleSubmit}
        busy={addMutation.isPending || editMutation.isPending}
        error={sheetError}
      />
    </div>
  );
}

function EmptyState({
  onAdd,
  loading,
}: {
  onAdd: () => void;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-dashed border-border p-6 text-center">
      <p className="text-sm text-muted-foreground">
        Add the rest of your family.
      </p>
      <Button size="sm" variant="outline" className="mt-3" onClick={onAdd}>
        Add a family member
      </Button>
    </div>
  );
}
