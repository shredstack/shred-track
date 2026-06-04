// ============================================
// Notes Insights v2 — Weekly digest
// ============================================
//
// Builds the 5-line "This week in your notes" payload rendered as a card
// on the CrossFit Insights tab. Spec §3.2. Email channel was descoped from
// PR 3 in favor of in-app only; the aggregator stays email-shaped so a
// future Inngest fan-out can reuse it without rework.
//
// The pure variant (`aggregateWeeklyDigestFromRows`) takes already-fetched
// rows so the bullet selection is unit-testable against synthetic data
// (per spec §5 PR 3). The DB-bound entry (`aggregateWeeklyDigest`) queries
// the same tables the existing aggregators use — no new schema.

import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  scoreMovementSignals,
  scoreNotesExtractions,
  scores,
  workoutSessions,
} from "@/db/schema";
import {
  aggregateDormantComplaintsFromRows,
  type DormantRow,
} from "./notes-extraction";
import type {
  NotesComplaint,
  NotesPerformanceMetric,
  NotesScalingReason,
} from "@/types/crossfit";

// ============================================
// Tunables
// ============================================

// Week boundary. The spec calls for Sunday-morning send in Mountain Time;
// for an in-app card "this week" is the trailing 7-day window ending at
// `now`. Both compute the same set of bullets given the same row set.
const WEEK_DAYS = 7;

// "New this week" requires at least this many distinct scores mentioning
// the topic in [weekSince, weekUntil] AND zero mentions in the look-back
// window. ≥ 2 keeps the bar at "pattern" not "one-off".
const NEW_COMPLAINT_MIN_MENTIONS = 2;
const NEW_COMPLAINT_PRIOR_DAYS = 28;

// "Newly scaled" — movement appears in this week's scaling rationale but
// not in the prior 7 days. One-shot mentions count; the qualitative shift
// is "did they scale this thing recently" not "do they scale it often".
const NEWLY_SCALED_PRIOR_DAYS = 7;

// "Quiet for N weeks" — reuse dormant aggregator with a digest-shaped
// window. Anything not mentioned in the last 28 days but mentioned ≥ 3×
// in the 28–84 day window before that fires.
const DORMANT_RECENT_DAYS = 28;
const DORMANT_HISTORY_DAYS = 84;

// Confidence floor for complaints — matches the rest of the insights
// stack so the digest doesn't disagree with the existing card.
const COMPLAINT_MIN_CONFIDENCE = 0.4;

// "Skip if fewer than" — the email plumbing in the spec lives behind this
// floor; we keep it for the in-app card so empty weeks don't render an
// almost-empty section.
const MIN_BULLETS = 2;

// `pace` and `set_split` are time bounds (smaller = faster); every other
// metric is higher-is-better. Used by the "best of week" picker.
const LOWER_IS_BETTER: ReadonlySet<NotesPerformanceMetric> = new Set([
  "pace",
  "set_split",
]);

// ============================================
// Public types
// ============================================

export type WeeklyDigestBullet =
  | {
      kind: "new_complaint";
      topic: string;
      mentions: number;
      examplePhrase: string;
    }
  | {
      kind: "newly_scaled";
      movement: string;
    }
  | {
      kind: "best_of_week";
      movement: string;
      metric: NotesPerformanceMetric;
      value: number;
      unit: string;
      window: string | null;
      qualitative: "better" | "same" | "worse" | null;
      phrase: string;
    }
  | {
      kind: "dormant";
      topic: string;
      weeksSilent: number;
      lastMentionedAt: string; // YYYY-MM-DD
    };

export type WeeklyDigest = {
  weekStartIso: string; // YYYY-MM-DD inclusive
  weekEndIso: string; // YYYY-MM-DD inclusive
  bullets: WeeklyDigestBullet[];
};

// ============================================
// Row shapes for the pure aggregator
// ============================================

// Per-score complaint snapshot — distinct topics already filtered by
// confidence so the aggregator doesn't need to know about the floor.
export type DigestComplaintRow = {
  scoreId: string;
  workoutDate: string;
  topics: string[];
  // First example phrase per topic — we use this verbatim in the
  // "New this week" bullet.
  phraseByTopic: Record<string, string>;
};

// Per-score scaling snapshot — one entry per distinct scaled movement.
export type DigestScalingRow = {
  scoreId: string;
  workoutDate: string;
  movements: string[]; // canonical-ish movement strings from the LLM
};

// Per-score performance signal — one row per signal (a score can have
// many across different movements / metrics).
export type DigestSignalRow = {
  scoreId: string;
  workoutDate: string;
  movement: string;
  metric: NotesPerformanceMetric;
  value: number;
  unit: string;
  window: string | null;
  qualitative: "better" | "same" | "worse" | null;
  phrase: string;
};

// ============================================
// Pure aggregator
// ============================================

export function aggregateWeeklyDigestFromRows(input: {
  now: Date;
  complaintRows: DigestComplaintRow[];
  scalingRows: DigestScalingRow[];
  signalRows: DigestSignalRow[];
}): WeeklyDigest | null {
  const { now, complaintRows, scalingRows, signalRows } = input;
  const weekStart = addDays(now, -WEEK_DAYS);
  const weekStartIso = isoFromDate(weekStart);
  const weekEndIso = isoFromDate(now);

  const bullets: WeeklyDigestBullet[] = [];

  // ---------- (a) New this week complaints ----------
  // Topic appears ≥ NEW_COMPLAINT_MIN_MENTIONS times in [weekStart, now]
  // AND zero times in [weekStart - 28d, weekStart).
  const priorComplaintStart = isoFromDate(
    addDays(weekStart, -NEW_COMPLAINT_PRIOR_DAYS)
  );
  const newCounts = new Map<string, number>();
  const newPhrases = new Map<string, string>();
  const priorTopics = new Set<string>();

  for (const row of complaintRows) {
    if (row.workoutDate < priorComplaintStart) continue;
    const inWeek = row.workoutDate >= weekStartIso;
    const inPrior =
      row.workoutDate >= priorComplaintStart && row.workoutDate < weekStartIso;
    for (const topic of row.topics) {
      if (!topic) continue;
      if (inWeek) {
        newCounts.set(topic, (newCounts.get(topic) ?? 0) + 1);
        if (!newPhrases.has(topic) && row.phraseByTopic[topic]) {
          newPhrases.set(topic, row.phraseByTopic[topic]);
        }
      } else if (inPrior) {
        priorTopics.add(topic);
      }
    }
  }

  const newComplaintCandidates: Array<{
    topic: string;
    mentions: number;
    examplePhrase: string;
  }> = [];
  for (const [topic, mentions] of newCounts) {
    if (mentions < NEW_COMPLAINT_MIN_MENTIONS) continue;
    if (priorTopics.has(topic)) continue;
    newComplaintCandidates.push({
      topic,
      mentions,
      examplePhrase: newPhrases.get(topic) ?? "",
    });
  }
  newComplaintCandidates.sort((a, b) => b.mentions - a.mentions);
  if (newComplaintCandidates.length > 0) {
    bullets.push({ kind: "new_complaint", ...newComplaintCandidates[0] });
  }

  // ---------- (b) Newly scaled this week ----------
  // Movement scaled in [weekStart, now] but not in [weekStart - 7d, weekStart).
  const priorScaledStart = isoFromDate(
    addDays(weekStart, -NEWLY_SCALED_PRIOR_DAYS)
  );
  const thisWeekScaled = new Map<string, string>(); // movement → latest workoutDate
  const priorScaled = new Set<string>();
  for (const row of scalingRows) {
    if (row.workoutDate < priorScaledStart) continue;
    const inWeek = row.workoutDate >= weekStartIso;
    const inPrior =
      row.workoutDate >= priorScaledStart && row.workoutDate < weekStartIso;
    for (const movement of row.movements) {
      if (!movement) continue;
      const key = movement.toLowerCase();
      if (inWeek) {
        const prev = thisWeekScaled.get(key);
        if (!prev || row.workoutDate > prev) {
          thisWeekScaled.set(key, row.workoutDate);
        }
      } else if (inPrior) {
        priorScaled.add(key);
      }
    }
  }
  const newlyScaledCandidates: Array<{ movement: string; date: string }> = [];
  // Walk original-case names so the bullet renders "Double Unders" not "double unders".
  const seenLower = new Set<string>();
  for (const row of scalingRows) {
    if (row.workoutDate < weekStartIso) continue;
    for (const movement of row.movements) {
      if (!movement) continue;
      const key = movement.toLowerCase();
      if (seenLower.has(key)) continue;
      seenLower.add(key);
      if (!thisWeekScaled.has(key)) continue;
      if (priorScaled.has(key)) continue;
      newlyScaledCandidates.push({
        movement,
        date: thisWeekScaled.get(key) ?? row.workoutDate,
      });
    }
  }
  newlyScaledCandidates.sort((a, b) => b.date.localeCompare(a.date));
  if (newlyScaledCandidates.length > 0) {
    bullets.push({
      kind: "newly_scaled",
      movement: newlyScaledCandidates[0].movement,
    });
  }

  // ---------- (c) Best of the week ----------
  // Pick one signal from this week with the strongest qualitative signal.
  // Tier 1: any signal with `qualitative: "better"` — explicit athlete
  // self-report wins.
  // Tier 2: highest reps_in_window / unbroken_reps value.
  // Tier 3: fastest pace / set_split.
  const weekSignals = signalRows.filter((s) => s.workoutDate >= weekStartIso);
  let best: DigestSignalRow | null = null;
  if (weekSignals.length > 0) {
    const betterTier = weekSignals.filter((s) => s.qualitative === "better");
    if (betterTier.length > 0) {
      best = betterTier.reduce((a, b) =>
        b.workoutDate.localeCompare(a.workoutDate) > 0 ? b : a
      );
    } else {
      const repTier = weekSignals.filter(
        (s) => s.metric === "reps_in_window" || s.metric === "unbroken_reps"
      );
      if (repTier.length > 0) {
        best = repTier.reduce((a, b) => (b.value > a.value ? b : a));
      } else {
        const paceTier = weekSignals.filter((s) =>
          LOWER_IS_BETTER.has(s.metric)
        );
        if (paceTier.length > 0) {
          best = paceTier.reduce((a, b) => (b.value < a.value ? b : a));
        } else {
          // Fall back to any signal; most recent wins.
          best = weekSignals.reduce((a, b) =>
            b.workoutDate.localeCompare(a.workoutDate) > 0 ? b : a
          );
        }
      }
    }
  }
  if (best) {
    bullets.push({
      kind: "best_of_week",
      movement: best.movement,
      metric: best.metric,
      value: best.value,
      unit: best.unit,
      window: best.window,
      qualitative: best.qualitative,
      phrase: best.phrase,
    });
  }

  // ---------- (d) Dormant complaint ----------
  // Reuse aggregateDormantComplaintsFromRows with a digest-sized window.
  const dormantRows: DormantRow[] = complaintRows.map((r) => ({
    scoreId: r.scoreId,
    workoutDate: r.workoutDate,
    topics: r.topics,
  }));
  const dormant = aggregateDormantComplaintsFromRows(dormantRows, now, {
    recentDays: DORMANT_RECENT_DAYS,
    historyDays: DORMANT_HISTORY_DAYS,
    historyMinDays: DORMANT_RECENT_DAYS,
    minPriorMentions: 3,
    maxOutput: 1,
  });
  if (dormant.length > 0) {
    const top = dormant[0];
    const weeksSilent = top.lastMentionedAt
      ? Math.max(1, Math.floor(daysBetween(top.lastMentionedAt, now) / 7))
      : Math.floor(DORMANT_RECENT_DAYS / 7);
    bullets.push({
      kind: "dormant",
      topic: top.topic,
      weeksSilent,
      lastMentionedAt: top.lastMentionedAt,
    });
  }

  if (bullets.length < MIN_BULLETS) return null;

  return {
    weekStartIso,
    weekEndIso,
    bullets,
  };
}

// ============================================
// DB-bound entry
// ============================================

export async function aggregateWeeklyDigest(
  userId: string,
  now: Date = new Date()
): Promise<WeeklyDigest | null> {
  // We need rows from up to 84 days back for the dormant bullet and 28
  // days back for the "new this week" prior check.
  const lookbackStart = isoFromDate(addDays(now, -DORMANT_HISTORY_DAYS));
  const today = isoFromDate(now);

  const extractionRows = await db
    .select({
      scoreId: scoreNotesExtractions.scoreId,
      complaints: scoreNotesExtractions.complaints,
      scalingRationale: scoreNotesExtractions.scalingRationale,
      workoutDate: workoutSessions.workoutDate,
    })
    .from(scoreNotesExtractions)
    .innerJoin(scores, eq(scores.id, scoreNotesExtractions.scoreId))
    .innerJoin(
      workoutSessions,
      eq(workoutSessions.id, scores.workoutSessionId)
    )
    .where(
      and(
        eq(scores.userId, userId),
        gte(workoutSessions.workoutDate, lookbackStart),
        lte(workoutSessions.workoutDate, today)
      )
    );

  const complaintRows: DigestComplaintRow[] = extractionRows.map((r) => {
    const topics: string[] = [];
    const phraseByTopic: Record<string, string> = {};
    for (const c of (r.complaints ?? []) as NotesComplaint[]) {
      if (!c || c.confidence < COMPLAINT_MIN_CONFIDENCE) continue;
      const topic = c.topic.trim().toLowerCase();
      if (!topic) continue;
      if (!topics.includes(topic)) topics.push(topic);
      if (!phraseByTopic[topic]) phraseByTopic[topic] = c.phrase;
    }
    return {
      scoreId: r.scoreId,
      workoutDate: r.workoutDate,
      topics,
      phraseByTopic,
    };
  });

  const scalingRows: DigestScalingRow[] = extractionRows.map((r) => {
    const movements = new Set<string>();
    for (const sr of (r.scalingRationale ?? []) as NotesScalingReason[]) {
      if (!sr || !sr.movement) continue;
      movements.add(sr.movement.trim());
    }
    return {
      scoreId: r.scoreId,
      workoutDate: r.workoutDate,
      movements: Array.from(movements),
    };
  });

  const weekStartIso = isoFromDate(addDays(now, -WEEK_DAYS));
  const signalRowsDb = await db
    .select({
      scoreId: scoreMovementSignals.scoreId,
      movement: scoreMovementSignals.movementName,
      metric: scoreMovementSignals.metric,
      value: scoreMovementSignals.value,
      unit: scoreMovementSignals.unit,
      window: scoreMovementSignals.window,
      qualitative: scoreMovementSignals.qualitative,
      phrase: scoreMovementSignals.phrase,
      workoutDate: scoreMovementSignals.workoutDate,
    })
    .from(scoreMovementSignals)
    .where(
      and(
        eq(scoreMovementSignals.userId, userId),
        gte(scoreMovementSignals.workoutDate, weekStartIso),
        lte(scoreMovementSignals.workoutDate, today)
      )
    );

  const signalRows: DigestSignalRow[] = signalRowsDb.map((r) => ({
    scoreId: r.scoreId,
    workoutDate: r.workoutDate,
    movement: r.movement,
    metric: r.metric as NotesPerformanceMetric,
    value: Number(r.value),
    unit: r.unit,
    window: r.window,
    qualitative: r.qualitative as "better" | "same" | "worse" | null,
    phrase: r.phrase,
  }));

  return aggregateWeeklyDigestFromRows({
    now,
    complaintRows,
    scalingRows,
    signalRows,
  });
}

// ============================================
// Date helpers (kept local — mirror the patterns in notes-extraction.ts)
// ============================================

function addDays(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function isoFromDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBetween(iso: string, now: Date): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return 0;
  const [y, m, d] = iso.split("-").map(Number);
  const then = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const diff = (now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, diff);
}
