/**
 * Database queries for HYROX Field Insights.
 *
 * All queries read from the `hyrox_public_division_aggregates` materialized view
 * or from `hyrox_public_events`. Never returns raw athlete rows.
 */

import { db } from "@/db";
import { hyroxPublicEvents } from "@/db/schema";
import { sql } from "drizzle-orm";
import { desc } from "drizzle-orm";

export type DivisionKey = "men_open" | "women_open" | "men_pro" | "women_pro";

export interface SegmentAggregate {
  divisionKey: string;
  eventId: string | null;
  segmentType: string;
  segmentLabel: string;
  n: number;
  meanSeconds: number;
  medianSeconds: number;
  p10: number;
  p25: number;
  p75: number;
  p90: number;
  stddevSeconds: number;
}

/**
 * Get average times per segment for a division, optionally scoped to an event.
 */
export async function getAverages(
  division: DivisionKey,
  eventId?: string,
): Promise<SegmentAggregate[]> {
  const eventCondition = eventId
    ? sql`AND event_id = ${eventId}::uuid`
    : sql`AND event_id IS NULL`;

  const rows = await db.execute(sql`
    SELECT
      division_key AS "divisionKey",
      event_id AS "eventId",
      segment_type AS "segmentType",
      segment_label AS "segmentLabel",
      n::int AS "n",
      mean_seconds::float AS "meanSeconds",
      median_seconds::float AS "medianSeconds",
      p10::float AS "p10",
      p25::float AS "p25",
      p75::float AS "p75",
      p90::float AS "p90",
      stddev_seconds::float AS "stddevSeconds"
    FROM hyrox_public_division_aggregates
    WHERE division_key = ${division}
    ${eventCondition}
    ORDER BY segment_label
  `);
  return rows as unknown as SegmentAggregate[];
}

/**
 * Get distributions (box plot data) for a specific segment type.
 */
export async function getDistributions(
  division: DivisionKey,
  segmentType: "run" | "station" | "roxzone",
  eventId?: string,
): Promise<SegmentAggregate[]> {
  const eventCondition = eventId
    ? sql`AND event_id = ${eventId}::uuid`
    : sql`AND event_id IS NULL`;

  const rows = await db.execute(sql`
    SELECT
      division_key AS "divisionKey",
      event_id AS "eventId",
      segment_type AS "segmentType",
      segment_label AS "segmentLabel",
      n::int AS "n",
      mean_seconds::float AS "meanSeconds",
      median_seconds::float AS "medianSeconds",
      p10::float AS "p10",
      p25::float AS "p25",
      p75::float AS "p75",
      p90::float AS "p90",
      stddev_seconds::float AS "stddevSeconds"
    FROM hyrox_public_division_aggregates
    WHERE division_key = ${division}
    AND segment_type = ${segmentType}
    ${eventCondition}
    ORDER BY segment_label
  `);
  return rows as unknown as SegmentAggregate[];
}

/**
 * Get top-20 vs bottom-20 vs average comparison for an event.
 */
export async function getComparisons(
  division: DivisionKey,
  eventId: string,
): Promise<{
  top20: SegmentAggregate[];
  bottom20: SegmentAggregate[];
  average: SegmentAggregate[];
}> {
  // Average — from the materialized view
  const average = await getAverages(division, eventId);

  // Top/bottom 20 — computed from raw splits, scoped to this event
  const top20Rows = await db.execute(sql`
    SELECT
      s.segment_type AS "segmentType",
      s.segment_label AS "segmentLabel",
      AVG(s.time_seconds)::float AS "meanSeconds"
    FROM hyrox_public_splits s
    JOIN hyrox_public_results r ON r.id = s.result_id
    WHERE r.division_key = ${division}
    AND r.event_id = ${eventId}::uuid
    AND r.is_dnf = false
    AND r.division_rank <= 20
    GROUP BY s.segment_type, s.segment_label
    ORDER BY s.segment_label
  `);

  const bottom20Rows = await db.execute(sql`
    SELECT
      s.segment_type AS "segmentType",
      s.segment_label AS "segmentLabel",
      AVG(s.time_seconds)::float AS "meanSeconds"
    FROM hyrox_public_splits s
    JOIN hyrox_public_results r ON r.id = s.result_id
    WHERE r.division_key = ${division}
    AND r.event_id = ${eventId}::uuid
    AND r.is_dnf = false
    AND r.division_rank > r.field_size_division - 20
    GROUP BY s.segment_type, s.segment_label
    ORDER BY s.segment_label
  `);

  return {
    top20: top20Rows as unknown as SegmentAggregate[],
    bottom20: bottom20Rows as unknown as SegmentAggregate[],
    average,
  };
}

/**
 * Get feature importances from the active RF model for a division.
 */
export async function getFeatureImportance(
  division: DivisionKey,
): Promise<{
  features: Array<{ feature: string; importance: number }>;
  trainingN: number;
  metrics: Record<string, number>;
} | null> {
  const rows = await db.execute(sql`
    SELECT
      feature_importances AS "featureImportances",
      training_n AS "trainingN",
      metrics
    FROM hyrox_predictor_models
    WHERE division_key = ${division}
    AND model_type = 'rf_percentile'
    AND is_active = true
    LIMIT 1
  `);

  const row = (rows as unknown as Array<{
    featureImportances: Array<{ feature: string; importance: number }>;
    trainingN: number;
    metrics: Record<string, number>;
  }>)[0];

  if (!row) return null;

  return {
    features: row.featureImportances,
    trainingN: row.trainingN,
    metrics: row.metrics,
  };
}

/**
 * Get list of available events.
 */
export async function getEvents(): Promise<
  Array<{ id: string; name: string; city: string; country: string; eventDate: string }>
> {
  const rows = await db
    .select({
      id: hyroxPublicEvents.id,
      name: hyroxPublicEvents.name,
      city: hyroxPublicEvents.city,
      country: hyroxPublicEvents.country,
      eventDate: hyroxPublicEvents.eventDate,
    })
    .from(hyroxPublicEvents)
    .orderBy(desc(hyroxPublicEvents.eventDate));
  return rows;
}
