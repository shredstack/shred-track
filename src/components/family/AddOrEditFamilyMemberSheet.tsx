// Sheet for adding or editing a dependent.
//
// Controlled — parent owns `open` and the result. On save the parent
// fires the mutation; we just collect input and validate format.

"use client";

import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FamilyMemberDTO } from "@/hooks/useFamily";

export type FamilyMemberSheetMode = "add" | "edit";

export interface FamilyMemberFormValues {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender?: "male" | "female" | "other";
  relationship: FamilyMemberDTO["relationship"];
  email: string;
  hasOwnLogin: boolean;
  notes: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: FamilyMemberSheetMode;
  initial?: FamilyMemberDTO | null;
  onSubmit: (values: FamilyMemberFormValues) => void;
  busy?: boolean;
  error?: string | null;
}

const RELATIONSHIPS: Array<FamilyMemberDTO["relationship"]> = [
  "spouse",
  "partner",
  "child",
  "parent",
  "sibling",
  "other",
];

// Base UI's <Select.Value> shows the raw value unless the <Select> root is
// given an `items` map from value → display label.
const GENDER_LABELS: Record<string, string> = {
  male: "Male",
  female: "Female",
  other: "Other",
};
const RELATIONSHIP_LABELS: Record<string, string> = Object.fromEntries(
  RELATIONSHIPS.map((r) => [r, capitalize(r)])
);

export function AddOrEditFamilyMemberSheet({
  open,
  onOpenChange,
  mode,
  initial,
  onSubmit,
  busy,
  error,
}: Props) {
  const [values, setValues] = useState<FamilyMemberFormValues>(() =>
    initialValues(initial)
  );
  const [localError, setLocalError] = useState<string | null>(null);

  // Re-seed when the sheet opens or the target row changes. Acceptable
  // setState-in-effect — we're synchronizing local form state to an
  // external "which member is being edited" signal.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (open) {
      setValues(initialValues(initial));
      setLocalError(null);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, initial]);

  // Implied minor when DOB indicates < 18. Used to gate the "has own
  // login" default and surface the guardian disclosure (spec §2.1).
  const implied = computeImpliedAge(values.dateOfBirth);
  const impliedMinor = implied != null && implied < 18;

  function patch<K extends keyof FamilyMemberFormValues>(
    key: K,
    val: FamilyMemberFormValues[K]
  ) {
    setValues((v) => ({ ...v, [key]: val }));
  }

  function handleSubmit() {
    setLocalError(null);
    if (!values.firstName.trim()) {
      setLocalError("First name is required.");
      return;
    }
    if (!values.relationship) {
      setLocalError("Please select a relationship.");
      return;
    }
    if (values.hasOwnLogin && !values.email.trim()) {
      setLocalError("Email is required when sign-in is enabled.");
      return;
    }
    onSubmit(values);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {mode === "add" ? "Add a family member" : "Edit family member"}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="fm-first">First name</Label>
              <Input
                id="fm-first"
                value={values.firstName}
                onChange={(e) => patch("firstName", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fm-last">Last name</Label>
              <Input
                id="fm-last"
                value={values.lastName}
                onChange={(e) => patch("lastName", e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fm-dob">Date of birth</Label>
            <Input
              id="fm-dob"
              type="date"
              value={values.dateOfBirth}
              onChange={(e) => patch("dateOfBirth", e.target.value)}
            />
            {impliedMinor && (
              <p className="text-xs text-amber-300">
                Under 18 — they&apos;ll need a guardian to sign waivers on their
                behalf.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fm-gender">Gender</Label>
            <Select
              value={values.gender ?? ""}
              items={GENDER_LABELS}
              onValueChange={(v) =>
                patch(
                  "gender",
                  (v || undefined) as FamilyMemberFormValues["gender"]
                )
              }
            >
              <SelectTrigger id="fm-gender">
                <SelectValue placeholder="Optional" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fm-rel">Relationship</Label>
            <Select
              value={values.relationship}
              items={RELATIONSHIP_LABELS}
              onValueChange={(v) =>
                patch("relationship", v as FamilyMemberDTO["relationship"])
              }
            >
              <SelectTrigger id="fm-rel">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {RELATIONSHIPS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {capitalize(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-lg bg-muted/30 p-3">
            <div>
              <p className="text-sm font-medium">Has their own login</p>
              <p className="text-xs text-muted-foreground">
                {values.hasOwnLogin
                  ? "We'll email them an invite to set a password."
                  : "You'll manage their account on their behalf."}
              </p>
            </div>
            <Switch
              checked={values.hasOwnLogin}
              onCheckedChange={(v) => patch("hasOwnLogin", v)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fm-email">
              Email {values.hasOwnLogin ? "" : "(optional)"}
            </Label>
            <Input
              id="fm-email"
              type="email"
              autoComplete="off"
              value={values.email}
              onChange={(e) => patch("email", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              If this email already belongs to a ShredTrack member, we&apos;ll
              send them a consent request instead of creating a new profile.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fm-notes">Notes (only you and gym admins see these)</Label>
            <Textarea
              id="fm-notes"
              rows={3}
              placeholder="Allergies, coach preferences, etc."
              value={values.notes}
              onChange={(e) => patch("notes", e.target.value)}
            />
          </div>

          {impliedMinor && mode === "add" && (
            <p className="text-xs text-muted-foreground">
              By adding {values.firstName || "this family member"}, you confirm
              you&apos;re their parent or legal guardian and have authority to
              manage their account.
            </p>
          )}

          {(localError || error) && (
            <p className="text-sm text-red-400">{localError ?? error}</p>
          )}
        </div>

        <SheetFooter className="px-4 pb-6 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={busy}>
            {busy
              ? "Saving…"
              : mode === "add"
                ? "Add family member"
                : "Save changes"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function initialValues(initial?: FamilyMemberDTO | null): FamilyMemberFormValues {
  if (!initial) {
    return {
      firstName: "",
      lastName: "",
      dateOfBirth: "",
      gender: undefined,
      relationship: "child",
      email: "",
      hasOwnLogin: false,
      notes: "",
    };
  }
  const [firstName, ...rest] = initial.dependent.name.split(" ");
  return {
    firstName: firstName ?? "",
    lastName: rest.join(" "),
    dateOfBirth: initial.dependent.dateOfBirth ?? "",
    gender: (initial.dependent.gender as FamilyMemberFormValues["gender"]) ?? undefined,
    relationship: initial.relationship,
    email: initial.isShadowEmail ? "" : initial.dependent.email,
    hasOwnLogin: initial.hasOwnLogin,
    notes: initial.notes ?? "",
  };
}

function computeImpliedAge(iso: string): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
