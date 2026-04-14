"""
Database operations for the HYROX scraper.

All writes use idempotent upserts. Each event is wrapped in a transaction
so a crash mid-run can't leave a half-written event.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime

import psycopg
from psycopg.rows import dict_row

from .models import ParsedEvent, ParsedResult, ParsedSplit

logger = logging.getLogger(__name__)


class HyroxDB:
    def __init__(self, db_url: str):
        self.db_url = db_url

    def _connect(self) -> psycopg.Connection:
        return psycopg.connect(self.db_url, row_factory=dict_row)

    def upsert_event(self, event: ParsedEvent) -> tuple[str, bool]:
        """
        Upsert an event. Returns (event_uuid, was_inserted).
        """
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO hyrox_public_events
                        (id, external_id, name, city, country, region, event_date, season, source_url, scraped_at)
                    VALUES
                        (gen_random_uuid(), %(external_id)s, %(name)s, %(city)s, %(country)s,
                         %(region)s, %(event_date)s, %(season)s, %(source_url)s, NOW())
                    ON CONFLICT (external_id) DO UPDATE SET
                        name = EXCLUDED.name,
                        city = EXCLUDED.city,
                        country = EXCLUDED.country,
                        region = EXCLUDED.region,
                        event_date = EXCLUDED.event_date,
                        season = EXCLUDED.season,
                        source_url = EXCLUDED.source_url,
                        scraped_at = NOW(),
                        updated_at = NOW()
                    RETURNING id, (xmax = 0) AS was_inserted
                    """,
                    {
                        "external_id": event.external_id,
                        "name": event.name,
                        "city": event.city,
                        "country": event.country,
                        "region": event.region,
                        "event_date": event.event_date.isoformat(),
                        "season": event.season,
                        "source_url": event.source_url,
                    },
                )
                row = cur.fetchone()
                conn.commit()
                return str(row["id"]), bool(row["was_inserted"])

    def upsert_results_batch(
        self,
        event_uuid: str,
        results: list[ParsedResult],
    ) -> dict:
        """
        Upsert a batch of results + their splits for a single event.
        Runs in a single transaction.

        Returns: {"inserted": int, "updated": int, "splits_replaced": int}
        """
        stats = {"inserted": 0, "updated": 0, "splits_replaced": 0}

        with self._connect() as conn:
            with conn.cursor() as cur:
                for result in results:
                    # Upsert result
                    cur.execute(
                        """
                        INSERT INTO hyrox_public_results
                            (id, event_id, external_result_id, external_athlete_hash,
                             division_key, age_group, finish_time_seconds,
                             overall_rank, division_rank, field_size_division,
                             percentile, is_dnf)
                        VALUES
                            (gen_random_uuid(), %(event_id)s, %(external_result_id)s,
                             %(external_athlete_hash)s, %(division_key)s, %(age_group)s,
                             %(finish_time_seconds)s, %(overall_rank)s, %(division_rank)s,
                             %(field_size_division)s, %(percentile)s, %(is_dnf)s)
                        ON CONFLICT (event_id, external_result_id) DO UPDATE SET
                            external_athlete_hash = EXCLUDED.external_athlete_hash,
                            division_key = EXCLUDED.division_key,
                            age_group = EXCLUDED.age_group,
                            finish_time_seconds = EXCLUDED.finish_time_seconds,
                            overall_rank = EXCLUDED.overall_rank,
                            division_rank = EXCLUDED.division_rank,
                            field_size_division = EXCLUDED.field_size_division,
                            percentile = EXCLUDED.percentile,
                            is_dnf = EXCLUDED.is_dnf,
                            updated_at = NOW()
                        RETURNING id, (xmax = 0) AS was_inserted
                        """,
                        {
                            "event_id": event_uuid,
                            "external_result_id": result.external_result_id,
                            "external_athlete_hash": result.external_athlete_hash,
                            "division_key": result.division_key,
                            "age_group": result.age_group,
                            "finish_time_seconds": result.finish_time_seconds,
                            "overall_rank": result.overall_rank,
                            "division_rank": result.division_rank,
                            "field_size_division": result.field_size_division,
                            "percentile": result.percentile,
                            "is_dnf": result.is_dnf,
                        },
                    )
                    row = cur.fetchone()
                    result_uuid = str(row["id"])
                    was_inserted = bool(row["was_inserted"])

                    if was_inserted:
                        stats["inserted"] += 1
                    else:
                        stats["updated"] += 1

                    # Delete-then-insert splits (simpler + handles corrections)
                    if result.splits:
                        cur.execute(
                            "DELETE FROM hyrox_public_splits WHERE result_id = %s",
                            (result_uuid,),
                        )
                        deleted = cur.rowcount
                        stats["splits_replaced"] += deleted

                        # Bulk insert splits
                        split_values = []
                        split_params = {}
                        for i, split in enumerate(result.splits):
                            prefix = f"s{i}_"
                            split_values.append(
                                f"(gen_random_uuid(), %({prefix}result_id)s, %({prefix}segment_order)s, "
                                f"%({prefix}segment_type)s, %({prefix}segment_label)s, "
                                f"%({prefix}station_name)s, %({prefix}run_number)s, "
                                f"%({prefix}time_seconds)s)"
                            )
                            split_params.update({
                                f"{prefix}result_id": result_uuid,
                                f"{prefix}segment_order": split.segment_order,
                                f"{prefix}segment_type": split.segment_type,
                                f"{prefix}segment_label": split.segment_label,
                                f"{prefix}station_name": split.station_name,
                                f"{prefix}run_number": split.run_number,
                                f"{prefix}time_seconds": split.time_seconds,
                            })

                        if split_values:
                            cur.execute(
                                f"""
                                INSERT INTO hyrox_public_splits
                                    (id, result_id, segment_order, segment_type,
                                     segment_label, station_name, run_number, time_seconds)
                                VALUES {', '.join(split_values)}
                                """,
                                split_params,
                            )

                conn.commit()

        return stats

    def refresh_materialized_view(self) -> None:
        """Refresh the division aggregates materialized view."""
        logger.info("Refreshing materialized view hyrox_public_division_aggregates...")
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("REFRESH MATERIALIZED VIEW hyrox_public_division_aggregates")
                conn.commit()
        logger.info("Materialized view refreshed.")

    def get_event_by_external_id(self, external_id: str) -> dict | None:
        """Lookup an event by external_id."""
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT * FROM hyrox_public_events WHERE external_id = %s",
                    (external_id,),
                )
                return cur.fetchone()

    def get_result_counts(self) -> dict:
        """Get result counts per division for summary."""
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT division_key, COUNT(*) as count
                    FROM hyrox_public_results
                    GROUP BY division_key
                    """
                )
                return {row["division_key"]: row["count"] for row in cur.fetchall()}

    def get_event_result_counts(self, event_external_id: str) -> dict:
        """Get result counts per division for a specific event. Returns {division_key: count}."""
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT r.division_key, COUNT(*) as count
                    FROM hyrox_public_results r
                    JOIN hyrox_public_events e ON e.id = r.event_id
                    WHERE e.external_id = %s
                    GROUP BY r.division_key
                    """,
                    (event_external_id,),
                )
                return {row["division_key"]: row["count"] for row in cur.fetchall()}

    def get_event_date(self, event_external_id: str) -> str | None:
        """Get the stored event_date for an event. Returns ISO date string or None."""
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT event_date FROM hyrox_public_events WHERE external_id = %s",
                    (event_external_id,),
                )
                row = cur.fetchone()
                if row and row["event_date"]:
                    return str(row["event_date"])
                return None
