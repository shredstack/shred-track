// Recovery feature types — shared between API routes, hooks, and UI.

export const RECOVERY_CATEGORIES = [
  "stretch",
  "mobility",
  "strength",
  "exercises",
  "breathwork",
  "soft_tissue",
  "other",
] as const;
export type RecoveryCategory = (typeof RECOVERY_CATEGORIES)[number];

export const RECOVERY_BODY_REGIONS = [
  "neck",
  "shoulder",
  "thoracic",
  "lower_back",
  "hip",
  "glute",
  "hamstring",
  "quad",
  "calf",
  "ankle",
  "knee",
  "wrist",
  "core",
  "full_body",
] as const;
export type RecoveryBodyRegion = (typeof RECOVERY_BODY_REGIONS)[number];

export type RecoveryBodyRegionFilter = "all" | RecoveryBodyRegion;
export type RecoveryCategoryFilter = "all" | RecoveryCategory;

const formatRegionLabel = (r: RecoveryBodyRegion) =>
  r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const formatCategoryLabel = (c: RecoveryCategory) =>
  c.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export const RECOVERY_BODY_REGION_FILTER_OPTIONS: {
  key: RecoveryBodyRegionFilter;
  label: string;
}[] = [
  { key: "all", label: "All" },
  ...RECOVERY_BODY_REGIONS.map((r) => ({ key: r, label: formatRegionLabel(r) })),
];

export const RECOVERY_CATEGORY_FILTER_OPTIONS: {
  key: RecoveryCategoryFilter;
  label: string;
}[] = [
  { key: "all", label: "All" },
  ...RECOVERY_CATEGORIES.map((c) => ({ key: c, label: formatCategoryLabel(c) })),
];

export type RecoveryVisibility = "public" | "gym" | "private";
export type RecoveryVideoSource = "upload" | "external";

export interface RecoveryPrescription {
  sets?: number;
  reps?: number;
  durationSeconds?: number;
  perSide?: boolean;
  cadence?: string;
  load?: string;
  tempo?: string;
}

export interface RecoveryMovement {
  id: string;
  canonicalName: string;
  slug: string;
  category: RecoveryCategory;
  bodyRegion: RecoveryBodyRegion[];
  description: string | null;
  defaultPrescription: RecoveryPrescription;
  isPerSide: boolean;
  isValidated: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  // Computed at read time:
  notesOverride?: string | null;
  videoCount?: number;
  isOwnSubmission?: boolean;
}

export interface RecoveryVideo {
  id: string;
  movementId: string;
  sourceType: RecoveryVideoSource;
  storagePath: string | null;
  externalUrl: string | null;
  externalProvider: string | null;
  externalVideoId: string | null;
  visibility: RecoveryVisibility;
  communityId: string | null;
  label: string | null;
  durationSeconds: number | null;
  posterStoragePath: string | null;
  rightsConfirmed: boolean;
  orderIndex: number;
  uploadedBy: string;
  createdAt: string;
  // Resolved at read time when source_type=upload:
  playbackUrl?: string | null;
  posterUrl?: string | null;
}

export interface RecoveryRoutine {
  id: string;
  name: string;
  description: string | null;
  isValidated: boolean;
  createdBy: string | null;
  communityId: string | null;
  createdAt: string;
  updatedAt: string;
  movements?: RecoveryRoutineMovement[];
}

export interface RecoveryRoutineMovement {
  id: string;
  routineId: string;
  movementId: string;
  orderIndex: number;
  prescription: RecoveryPrescription;
  notes: string | null;
  // Joined fields:
  movementName?: string;
  isPerSide?: boolean;
}

export type RecoveryScheduleKind = "day_keyed" | "frequency_keyed";
export type RecoveryRotationStrategy = "progress" | "calendar";

export interface RecoverySchedule {
  id: string;
  name: string;
  kind: RecoveryScheduleKind;
  rotationDays: number | null;
  weeklyTarget: number | null;
  description: string | null;
  rotationStrategy: RecoveryRotationStrategy;
  communityId: string | null;
  createdBy: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  slots?: RecoveryScheduleSlot[];
}

export interface RecoveryScheduleSlot {
  id: string;
  scheduleId: string;
  dayIndex: number | null;
  orderIndex: number;
  movementId: string | null;
  routineId: string | null;
  prescription: RecoveryPrescription;
  notes: string | null;
  // Joined:
  movementName?: string;
  routineName?: string;
  isPerSide?: boolean;
  routineMovements?: RecoveryRoutineMovement[];
}

export interface RecoveryAssignment {
  id: string;
  scheduleId: string;
  userId: string | null;
  communityId: string | null;
  startsOn: string;
  endsOn: string | null;
  durationLabel: string | null;
  assignedBy: string;
  createdAt: string;
}

export interface RecoveryAssignmentOverride {
  id: string;
  assignmentId: string;
  userId: string;
  startsOn: string | null;
  endsOn: string | null;
  isDismissed: boolean;
  updatedAt: string;
}

export type RecoverySessionStatus = "in_progress" | "complete" | "skipped";
export type RecoverySessionItemStatus = "pending" | "done" | "skipped";

export interface RecoverySession {
  id: string;
  userId: string;
  scheduleId: string | null;
  assignmentId: string | null;
  sessionDate: string;
  dayIndex: number | null;
  status: RecoverySessionStatus;
  notes: string | null;
  startedAt: string;
  completedAt: string | null;
  items?: RecoverySessionItem[];
}

export interface RecoverySessionItem {
  id: string;
  sessionId: string;
  movementId: string;
  routineId: string | null;
  scheduleSlotId: string | null;
  orderIndex: number;
  prescribed: RecoveryPrescription;
  actual: Record<string, unknown>;
  status: RecoverySessionItemStatus;
  notes: string | null;
  movementName?: string;
  isPerSide?: boolean;
  description?: string | null;
  videos?: RecoveryVideo[];
}

// Format a prescription as a human-readable string.
export function formatPrescription(
  rx: RecoveryPrescription,
  isPerSide = false
): string {
  const sets = rx.sets ?? null;
  const reps = rx.reps ?? null;
  const dur = rx.durationSeconds ?? null;
  const perSide = rx.perSide ?? isPerSide;

  let core = "";
  if (sets && reps) core = `${sets} × ${reps}`;
  else if (sets && dur) core = `${sets} × :${String(dur).padStart(2, "0")}`;
  else if (reps) core = `${reps} reps`;
  else if (dur) core = `${dur}s hold`;
  else if (sets) core = `${sets} sets`;

  if (perSide && core) core += " per side";
  return core;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
