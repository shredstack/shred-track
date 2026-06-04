import { describe, it, expect } from "vitest";
import {
  aggregateDormantComplaintsFromRows,
  aggregateRpeComplaintCorrelationFromRows,
  aggregateTemporalComplaintsFromRows,
  type DormantRow,
  type RpeCorrelationRow,
  type TemporalRow,
} from "./notes-extraction";

// ============================================
// Helpers — date math
// ============================================

const DAY_MS = 24 * 60 * 60 * 1000;
const FIXED_NOW = new Date("2026-06-04T12:00:00Z");

function isoDaysAgo(n: number): string {
  return new Date(FIXED_NOW.getTime() - n * DAY_MS).toISOString().slice(0, 10);
}

// 2026-06-04 is a Thursday in UTC; offsets below land deliberately on
// specific weekdays so the temporal aggregator's DOW logic is easy to
// reason about.
function isoForDow(weekday: "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun"): string {
  // Pick a baseline week and shift; use simple lookups (UTC) to dodge DST.
  const baseWed = new Date(Date.UTC(2026, 4, 13)); // 2026-05-13 = Wednesday
  const dowOffsets: Record<string, number> = {
    Sun: -3,
    Mon: -2,
    Tue: -1,
    Wed: 0,
    Thu: 1,
    Fri: 2,
    Sat: 3,
  };
  const d = new Date(baseWed.getTime() + dowOffsets[weekday] * DAY_MS);
  return d.toISOString().slice(0, 10);
}

// Produce N rows on the same weekday, each one workout later than the prior
// (so the post-rest detector doesn't fire — every row is 7 days after the
// previous one and treated as "after rest", which we don't want for the DOW
// suite). To prevent the post-rest signal from polluting these DOW tests we
// space them out within the same calendar week run rather than across weeks.
function dowRowsAcrossWeeks(
  weekday: Parameters<typeof isoForDow>[0],
  count: number,
  topics: string[][],
  scoreIdPrefix: string
): TemporalRow[] {
  // 7-day gaps between rows on the same weekday — every row beyond the
  // first is "after rest" by our definition. We control that in the dow
  // tests by padding the in-between days with "filler" rows.
  const baseWed = new Date(Date.UTC(2026, 4, 13));
  const dowOffsets: Record<string, number> = {
    Sun: -3,
    Mon: -2,
    Tue: -1,
    Wed: 0,
    Thu: 1,
    Fri: 2,
    Sat: 3,
  };
  return Array.from({ length: count }, (_, i) => {
    const day = new Date(
      baseWed.getTime() + dowOffsets[weekday] * DAY_MS + i * 7 * DAY_MS
    );
    return {
      scoreId: `${scoreIdPrefix}-${i}`,
      workoutDate: day.toISOString().slice(0, 10),
      topics: topics[i] ?? [],
    };
  });
}

// Filler rows on Tue/Wed/Thu/Fri/Sat to ensure DOW rate comparisons aren't
// dominated by tiny session counts on those days. These rows carry no
// topics, so they only contribute to the bucket session count.
function fillerWeekRows(weeks: number, scoreIdPrefix: string): TemporalRow[] {
  const out: TemporalRow[] = [];
  const days: Parameters<typeof isoForDow>[0][] = [
    "Tue",
    "Wed",
    "Thu",
    "Fri",
    "Sat",
  ];
  for (let w = 0; w < weeks; w++) {
    for (const d of days) {
      const base = new Date(isoForDow(d));
      const date = new Date(base.getTime() + w * 7 * DAY_MS)
        .toISOString()
        .slice(0, 10);
      out.push({ scoreId: `${scoreIdPrefix}-${d}-${w}`, workoutDate: date, topics: [] });
    }
  }
  return out;
}

// ============================================
// aggregateTemporalComplaintsFromRows — DOW
// ============================================

describe("aggregateTemporalComplaintsFromRows", () => {
  it("returns [] for no rows", () => {
    expect(aggregateTemporalComplaintsFromRows([])).toEqual([]);
  });

  it("surfaces a DOW callout when bucket rate ≥ 2× the other-bucket rate", () => {
    // 4 Mondays, all mentioning "tired". 12 weekdays of filler with no
    // mentions. Monday rate = 4/4 = 1.0; other-day rate = 0/12 = 0 — but
    // we skip zero-baseline buckets (infinite lift is meaningless). Add a
    // single non-Monday mention so the baseline is non-zero and the lift
    // is computable.
    const rows: TemporalRow[] = [
      ...dowRowsAcrossWeeks("Mon", 4, [["tired"], ["tired"], ["tired"], ["tired"]], "mon"),
      ...fillerWeekRows(4, "fill"),
      // Single Tuesday with the same topic — baseline rate becomes
      // 1 mention / (4 Tue sessions + 4 Wed + 4 Thu + 4 Fri + 4 Sat) = 1/20
      // Monday rate = 4/4 = 1.0; lift = 1.0 / (1/20) = 20× → callout fires.
      {
        scoreId: "tue-once",
        workoutDate: isoForDow("Tue"),
        topics: ["tired"],
      },
    ];
    const out = aggregateTemporalComplaintsFromRows(rows);
    const dow = out.find((c) => c.dimension === "dow" && c.topic === "tired");
    expect(dow).toBeDefined();
    expect(dow!.bucket).toBe("Mon");
    expect(dow!.mentions).toBe(4);
  });

  it("does not surface a DOW callout below the 4-mention floor", () => {
    const rows: TemporalRow[] = [
      ...dowRowsAcrossWeeks("Mon", 3, [["tired"], ["tired"], ["tired"]], "mon"),
      ...fillerWeekRows(4, "fill"),
    ];
    const out = aggregateTemporalComplaintsFromRows(rows);
    expect(out.filter((c) => c.dimension === "dow")).toEqual([]);
  });

  it("does not surface a DOW callout when lift < 2×", () => {
    // 4 mentions on Monday, plus 4 mentions across other days — lift = 1×
    const others: TemporalRow[] = [
      { scoreId: "tue", workoutDate: isoForDow("Tue"), topics: ["tired"] },
      { scoreId: "wed", workoutDate: isoForDow("Wed"), topics: ["tired"] },
      { scoreId: "thu", workoutDate: isoForDow("Thu"), topics: ["tired"] },
      { scoreId: "fri", workoutDate: isoForDow("Fri"), topics: ["tired"] },
    ];
    const rows: TemporalRow[] = [
      ...dowRowsAcrossWeeks("Mon", 4, [["tired"], ["tired"], ["tired"], ["tired"]], "mon"),
      ...others,
    ];
    const out = aggregateTemporalComplaintsFromRows(rows);
    expect(out.filter((c) => c.dimension === "dow" && c.bucket === "Mon")).toEqual([]);
  });

  it("dedupes topics within a single score", () => {
    // Two phrases for the same topic on the same Monday score shouldn't
    // count as two mentions. With dedup, this row contributes 1 mention.
    const rows: TemporalRow[] = [
      {
        scoreId: "dup",
        workoutDate: isoForDow("Mon"),
        topics: ["tired", "tired"],
      },
    ];
    const out = aggregateTemporalComplaintsFromRows(rows);
    // Below the 4-mention floor, so nothing surfaces.
    expect(out).toEqual([]);
  });

  it("surfaces a post_rest callout when post-rest rate ≥ 2× non-post-rest rate", () => {
    // Pattern: rest day → workout (post-rest, mentions "soreness") →
    // next-day workout (not post-rest, no mention). 5 such pairs gives us
    // 5 post-rest mentions and a clear-above-floor lift.
    const rows: TemporalRow[] = [];
    for (let pair = 0; pair < 5; pair++) {
      // pair*4: post-rest workout (gap of 3 days from prior non-post-rest)
      // pair*4+1: back-to-back workout (gap = 1, NOT post-rest)
      const postRestDay = new Date(
        Date.UTC(2026, 3, 1) + (pair * 4) * DAY_MS
      )
        .toISOString()
        .slice(0, 10);
      const nextDay = new Date(
        Date.UTC(2026, 3, 1) + (pair * 4 + 1) * DAY_MS
      )
        .toISOString()
        .slice(0, 10);
      rows.push({
        scoreId: `post-${pair}`,
        workoutDate: postRestDay,
        topics: ["soreness"],
      });
      rows.push({
        scoreId: `next-${pair}`,
        workoutDate: nextDay,
        topics: [],
      });
    }
    const out = aggregateTemporalComplaintsFromRows(rows);
    const postRest = out.find((c) => c.dimension === "post_rest");
    expect(postRest).toBeDefined();
    expect(postRest!.topic).toBe("soreness");
    expect(postRest!.mentions).toBeGreaterThanOrEqual(4);
  });
});

// ============================================
// aggregateRpeComplaintCorrelationFromRows
// ============================================

describe("aggregateRpeComplaintCorrelationFromRows", () => {
  function makeRpeRows(
    count: number,
    rpeValues: number[],
    topicsByIndex: (i: number) => string[]
  ): RpeCorrelationRow[] {
    return Array.from({ length: count }, (_, i) => ({
      scoreId: `s-${i}`,
      rpe: rpeValues[i] ?? 5,
      topics: topicsByIndex(i),
    }));
  }

  it("returns [] when fewer than 20 RPE-logged scores exist", () => {
    const rows = makeRpeRows(19, Array(19).fill(10), () => ["tired"]);
    expect(aggregateRpeComplaintCorrelationFromRows(rows)).toEqual([]);
  });

  it("surfaces a callout when high-RPE rate ≥ 3× overall rate", () => {
    // 20 scores total. 5 are RPE ≥ 9 and all mention "shoulder".
    // 15 are RPE < 9 and none mention "shoulder".
    // High rate = 5/5 = 1.0; overall = 5/20 = 0.25; lift = 4×.
    const rows: RpeCorrelationRow[] = [];
    for (let i = 0; i < 5; i++) {
      rows.push({ scoreId: `hi-${i}`, rpe: 9.5, topics: ["shoulder"] });
    }
    for (let i = 0; i < 15; i++) {
      rows.push({ scoreId: `lo-${i}`, rpe: 6, topics: [] });
    }
    const out = aggregateRpeComplaintCorrelationFromRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0].topic).toBe("shoulder");
    expect(out[0].highRpeMentions).toBe(5);
  });

  it("rejects topics with < 3 total mentions", () => {
    const rows: RpeCorrelationRow[] = [];
    for (let i = 0; i < 2; i++) {
      rows.push({ scoreId: `hi-${i}`, rpe: 10, topics: ["shoulder"] });
    }
    for (let i = 0; i < 18; i++) {
      rows.push({ scoreId: `lo-${i}`, rpe: 5, topics: [] });
    }
    expect(aggregateRpeComplaintCorrelationFromRows(rows)).toEqual([]);
  });

  it("rejects when lift < 3×", () => {
    // 20 scores: 5 high-RPE with topic, 15 low-RPE with topic.
    // High rate = 5/5 = 1.0; overall = 20/20 = 1.0; lift = 1×.
    const rows = makeRpeRows(
      20,
      [...Array(5).fill(10), ...Array(15).fill(6)],
      () => ["tired"]
    );
    expect(aggregateRpeComplaintCorrelationFromRows(rows)).toEqual([]);
  });

  it("returns at most one callout (the strongest lift)", () => {
    // Two qualifying topics — only one should come back.
    const rows: RpeCorrelationRow[] = [];
    for (let i = 0; i < 5; i++) {
      rows.push({
        scoreId: `hi-${i}`,
        rpe: 9.5,
        topics: ["shoulder", "grip"],
      });
    }
    for (let i = 0; i < 15; i++) {
      rows.push({ scoreId: `lo-${i}`, rpe: 5, topics: [] });
    }
    const out = aggregateRpeComplaintCorrelationFromRows(rows);
    expect(out).toHaveLength(1);
  });
});

// ============================================
// aggregateDormantComplaintsFromRows
// ============================================

describe("aggregateDormantComplaintsFromRows", () => {
  it("returns [] when no topic qualifies", () => {
    expect(aggregateDormantComplaintsFromRows([], FIXED_NOW)).toEqual([]);
  });

  it("surfaces a topic mentioned ≥3× in 30-90d window but 0× in last 28d", () => {
    const rows: DormantRow[] = [
      // History window (30-90 days ago)
      { scoreId: "h1", workoutDate: isoDaysAgo(80), topics: ["grip"] },
      { scoreId: "h2", workoutDate: isoDaysAgo(60), topics: ["grip"] },
      { scoreId: "h3", workoutDate: isoDaysAgo(40), topics: ["grip"] },
      // Recent window (last 28 days) — no grip
      { scoreId: "r1", workoutDate: isoDaysAgo(10), topics: ["shoulder"] },
    ];
    const out = aggregateDormantComplaintsFromRows(rows, FIXED_NOW);
    expect(out).toHaveLength(1);
    expect(out[0].topic).toBe("grip");
    expect(out[0].priorMentions).toBe(3);
    expect(out[0].lastMentionedAt).toBe(isoDaysAgo(40));
  });

  it("does NOT surface a topic still mentioned recently", () => {
    const rows: DormantRow[] = [
      { scoreId: "h1", workoutDate: isoDaysAgo(80), topics: ["grip"] },
      { scoreId: "h2", workoutDate: isoDaysAgo(60), topics: ["grip"] },
      { scoreId: "h3", workoutDate: isoDaysAgo(40), topics: ["grip"] },
      // Recent mention — disqualifies grip
      { scoreId: "r1", workoutDate: isoDaysAgo(10), topics: ["grip"] },
    ];
    expect(aggregateDormantComplaintsFromRows(rows, FIXED_NOW)).toEqual([]);
  });

  it("requires ≥ 3 prior mentions", () => {
    const rows: DormantRow[] = [
      { scoreId: "h1", workoutDate: isoDaysAgo(60), topics: ["grip"] },
      { scoreId: "h2", workoutDate: isoDaysAgo(40), topics: ["grip"] },
    ];
    expect(aggregateDormantComplaintsFromRows(rows, FIXED_NOW)).toEqual([]);
  });

  it("caps output at 2 entries (most recent first)", () => {
    const rows: DormantRow[] = [
      // Three dormant topics, each with 3 mentions in history.
      { scoreId: "h1", workoutDate: isoDaysAgo(80), topics: ["grip"] },
      { scoreId: "h2", workoutDate: isoDaysAgo(60), topics: ["grip"] },
      { scoreId: "h3", workoutDate: isoDaysAgo(50), topics: ["grip"] },

      { scoreId: "h4", workoutDate: isoDaysAgo(85), topics: ["hip"] },
      { scoreId: "h5", workoutDate: isoDaysAgo(70), topics: ["hip"] },
      { scoreId: "h6", workoutDate: isoDaysAgo(45), topics: ["hip"] },

      { scoreId: "h7", workoutDate: isoDaysAgo(80), topics: ["shoulder"] },
      { scoreId: "h8", workoutDate: isoDaysAgo(60), topics: ["shoulder"] },
      { scoreId: "h9", workoutDate: isoDaysAgo(35), topics: ["shoulder"] },
    ];
    const out = aggregateDormantComplaintsFromRows(rows, FIXED_NOW);
    expect(out).toHaveLength(2);
    // shoulder (last @ 35d) comes before hip (last @ 45d) comes before grip
    expect(out[0].topic).toBe("shoulder");
    expect(out[1].topic).toBe("hip");
  });
});
