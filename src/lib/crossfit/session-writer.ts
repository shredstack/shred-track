// ---------------------------------------------------------------------------
// Workout-session writer.
//
// Creates a `workout_sessions` row pointing at a template (or a freeform
// body for warm-up / stretching kinds). Replaces today's `workouts` and
// `workout_sections` writers — both kinds of "this happened on this date"
// row now go through here.
//
// Scope rules (enforced both here and at the DB CHECK constraint):
//   - personal log:          userId set, communityId null
//   - gym programming:       userId null, communityId set
//   - freeform kinds:        crossfitWorkoutId null, body set
//   - structured kinds:      crossfitWorkoutId set
// ---------------------------------------------------------------------------

import { and, desc, eq, max, sql } from "drizzle-orm";
import {
  workoutSessions,
  type WorkoutSession,
  type NewWorkoutSession,
  FREEFORM_SESSION_KINDS,
  type FreeformSessionKind,
  type WorkoutSessionKind,
  type WorkoutSessionScoreType,
} from "@/db/schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

export type CreateSessionInput = {
  // Either a template-backed session or a freeform body. Validated below.
  crossfitWorkoutId?: string | null;
  body?: string | null;
  // Scope
  userId?: string | null;
  communityId?: string | null;
  // When & where in the day
  workoutDate: string; // ISO YYYY-MM-DD
  kind?: WorkoutSessionKind;
  subKind?: string | null;
  position?: number | null;
  title?: string | null;
  // Scoring
  isScored?: boolean;
  scoreType?: WorkoutSessionScoreType | null;
  coachNotes?: string | null;
  // Provenance
  source?: string;
  programmingReleaseId?: string | null;
  sourceTrackId?: string | null;
  published?: boolean;
  reviewedAt?: Date | null;
  // Per-session calorie estimate (athlete-bodyweight scaled).
  estimatedKcalLow?: number | null;
  estimatedKcalHigh?: number | null;
  estimatedKcalConfidence?: string | null;
};

function isFreeformKind(kind: WorkoutSessionKind | undefined): boolean {
  if (!kind) return false;
  return (FREEFORM_SESSION_KINDS as readonly string[]).includes(kind);
}

function validateInput(input: CreateSessionInput): void {
  const kind = input.kind ?? "wod";

  // Exactly one of userId / communityId.
  const hasUser = !!input.userId;
  const hasCommunity = !!input.communityId;
  if (hasUser === hasCommunity) {
    throw new Error(
      "workout_sessions: exactly one of userId or communityId must be set"
    );
  }

  // Template / body consistency.
  if (isFreeformKind(kind)) {
    if (input.crossfitWorkoutId) {
      throw new Error(
        `workout_sessions: kind=${kind} must not have a template (freeform body only)`
      );
    }
    if (!input.body || input.body.trim() === "") {
      throw new Error(`workout_sessions: kind=${kind} requires a non-empty body`);
    }
  } else {
    if (!input.crossfitWorkoutId) {
      throw new Error(
        `workout_sessions: kind=${kind} requires a crossfitWorkoutId`
      );
    }
  }
}

export async function createSession(
  tx: Tx,
  input: CreateSessionInput
): Promise<WorkoutSession> {
  validateInput(input);

  const values: NewWorkoutSession = {
    crossfitWorkoutId: input.crossfitWorkoutId ?? null,
    userId: input.userId ?? null,
    communityId: input.communityId ?? null,
    workoutDate: input.workoutDate,
    kind: input.kind ?? "wod",
    subKind: input.subKind ?? null,
    position: input.position ?? 0,
    title: input.title ?? null,
    body: input.body ?? null,
    isScored: !!input.isScored,
    scoreType: input.scoreType ?? null,
    coachNotes: input.coachNotes ?? null,
    source: input.source ?? "manual",
    programmingReleaseId: input.programmingReleaseId ?? null,
    sourceTrackId: input.sourceTrackId ?? null,
    published: !!input.published,
    reviewedAt: input.reviewedAt ?? null,
    estimatedKcalLow: input.estimatedKcalLow ?? null,
    estimatedKcalHigh: input.estimatedKcalHigh ?? null,
    estimatedKcalConfidence: input.estimatedKcalConfidence ?? null,
  };

  const [row] = await tx.insert(workoutSessions).values(values).returning();
  return row;
}

export type UpdateSessionInput = Partial<
  Pick<
    NewWorkoutSession,
    | "crossfitWorkoutId"
    | "workoutDate"
    | "kind"
    | "subKind"
    | "position"
    | "title"
    | "body"
    | "isScored"
    | "scoreType"
    | "coachNotes"
    | "source"
    | "programmingReleaseId"
    | "sourceTrackId"
    | "published"
    | "reviewedAt"
    | "estimatedKcalLow"
    | "estimatedKcalHigh"
    | "estimatedKcalConfidence"
    | "userId"
    | "communityId"
  >
>;

export async function updateSession(
  tx: Tx,
  sessionId: string,
  patch: UpdateSessionInput
): Promise<WorkoutSession | null> {
  const [row] = await tx
    .update(workoutSessions)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(workoutSessions.id, sessionId))
    .returning();
  return row ?? null;
}

// Resolve the next available `position` for a programming day. Sessions are
// ordered 0..N within (community_id, workout_date); this returns N+1 (or 0
// if no rows exist yet).
export async function nextPositionForDay(
  tx: Tx,
  opts: { communityId: string; workoutDate: string }
): Promise<number> {
  const [row] = await tx
    .select({ maxPos: max(workoutSessions.position) })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.communityId, opts.communityId),
        eq(workoutSessions.workoutDate, opts.workoutDate)
      )
    );
  const maxPos = row?.maxPos as number | null | undefined;
  return (maxPos ?? -1) + 1;
}

// Resolve the most-recent session for a user (e.g. for the home page hero
// card). Used by the today widget & feed.
export async function latestUserSession(
  tx: Tx,
  userId: string
): Promise<WorkoutSession | null> {
  const [row] = await tx
    .select()
    .from(workoutSessions)
    .where(eq(workoutSessions.userId, userId))
    .orderBy(desc(workoutSessions.workoutDate), desc(workoutSessions.createdAt))
    .limit(1);
  return row ?? null;
}

export type { WorkoutSession, FreeformSessionKind };
