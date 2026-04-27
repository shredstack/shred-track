#!/usr/bin/env python3
"""
HYROX Results Scraper — ad-hoc, manually-run script.

Scrapes public HYROX race results from results.hyrox.com and upserts into
the ShredTrack database. Idempotent: safe to re-run on the same data.

Usage:
    cd scripts
    uv run scrape_hyrox.py --since 2024-04-01 --divisions men_open,women_open,men_pro,women_pro
    uv run scrape_hyrox.py --since 2024-04-01 --dry-run
    uv run scrape_hyrox.py --since 2024-04-01 --events "2025 London"
    uv run scrape_hyrox.py --since 2024-04-01 --divisions all
    uv run scrape_hyrox.py --since 2024-04-01 --pick   # interactive event selection
"""

from __future__ import annotations

import json
import logging
import os
import random
import re
import sys
import time
from datetime import date, datetime
from pathlib import Path

import click
import requests
from bs4 import BeautifulSoup
from dotenv import dotenv_values

from hyrox_scraper import selectors as sel
from hyrox_scraper.db import HyroxDB
from hyrox_scraper.models import (
    ParsedEvent,
    ParsedResult,
    ParsedSplit,
    city_to_country,
    country_to_region,
)
from hyrox_scraper.parser import (
    fetch_event_date_from_hyresult,
    parse_athlete_detail,
    parse_event_groups_from_race_page,
    parse_race_names,
    parse_result_count,
    parse_results_page,
    parse_time_to_seconds,
)

logger = logging.getLogger("scrape_hyrox")


def setup_logging(env: str) -> Path:
    """Configure logging to both console and a timestamped file."""
    log_dir = Path(__file__).parent / "logs"
    log_dir.mkdir(exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_file = log_dir / f"scrape_{env}_{timestamp}.log"

    fmt = logging.Formatter(
        "%(asctime)s %(levelname)s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    # Console handler
    console = logging.StreamHandler()
    console.setFormatter(fmt)

    # File handler
    file_handler = logging.FileHandler(log_file)
    file_handler.setFormatter(fmt)

    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(console)
    root.addHandler(file_handler)

    logger.info(f"Logging to {log_file}")
    return log_file

# Rate limit: max 1 req/sec with jitter
MIN_DELAY = 0.8
MAX_DELAY = 1.5

# Backoff schedule (seconds, jitter added). First three attempts recover quickly
# from transient blips; later attempts wait longer for sustained upstream outages
# (results.hyrox.com regularly returns 502/504 in clusters lasting tens of seconds).
RETRY_BACKOFF_SCHEDULE = [1, 2, 4, 15, 45, 120]
DEFAULT_RETRIES = len(RETRY_BACKOFF_SCHEDULE)

USER_AGENT = "ShredTrack Research Script (shredstacksarah@gmail.com)"


# ---------------------------------------------------------------------------
# Division key helpers
# ---------------------------------------------------------------------------

def _get_event_prefix(event_id: str) -> str | None:
    """Extract the known prefix from an event_id, or None if unrecognized."""
    for prefix in sorted(sel.EVENT_PREFIX_TO_DIVISION.keys(), key=len, reverse=True):
        if event_id.startswith(prefix):
            return prefix
    return None


def _determine_gender_variants(event_prefix: str) -> list[tuple[str | None, str]]:
    """
    For a given event prefix, return the list of (sex_filter, gender_key) pairs
    to iterate over when scraping results.

    Singles/Adaptive/Youngstars: [("M", "men"), ("W", "women")]
    Doubles/Relay/Corporate:    [("M", "men"), ("W", "women"), (None, "mixed")]
      - Mixed results don't use a sex filter; they appear when no filter is applied.
        We scrape mixed by fetching without a sex filter and deduplicating.
    """
    if event_prefix in sel.MIXED_GENDER_PREFIXES:
        return [("M", "men"), ("W", "women"), (None, "mixed")]
    return [("M", "men"), ("W", "women")]


def _build_division_key(base: str, gender: str) -> str:
    """
    Build a full division_key from the base (from prefix mapping) and gender.

    Examples:
        ("open", "men") → "men_open"
        ("pro", "women") → "women_pro"
        ("doubles_open", "mixed") → "doubles_mixed_open"
        ("elite_15", "women") → "elite_15_women"
        ("relay", "men") → "relay_men"
        ("youngstars_8_9", "women") → "youngstars_8_9_women"
    """
    # For the original singles divisions, the format is "{gender}_{tier}"
    if base in ("open", "pro"):
        return f"{gender}_{base}"

    # For doubles divisions with tier suffix, insert gender before tier
    # e.g. "doubles_open" → "doubles_{gender}_open"
    if base.startswith("doubles_") or base.startswith("elite_15_doubles"):
        parts = base.rsplit("_", 1)  # split off the last part (open/pro)
        if len(parts) == 2 and parts[1] in ("open", "pro"):
            return f"{parts[0]}_{gender}_{parts[1]}"
        # elite_15_doubles has no tier suffix
        return f"{base}_{gender}"

    # Everything else: append gender
    # e.g. "relay" → "relay_{gender}", "youngstars_8_9" → "youngstars_8_9_{gender}"
    return f"{base}_{gender}"


class HyroxScraper:
    def __init__(
        self,
        db: HyroxDB | None,
        since: date,
        divisions: list[str],
        event_filter: list[str] | None = None,
        dry_run: bool = False,
        force: bool = False,
    ):
        self.db = db
        self.since = since
        self.divisions = divisions
        self.scrape_all = "all" in divisions
        self.event_filter = [e.lower() for e in event_filter] if event_filter else None
        self.dry_run = dry_run
        self.force = force
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT})

        # Stats
        self.stats = {
            "events_touched": 0,
            "events_skipped_future": 0,
            "events_skipped_complete": 0,
            "divisions_scraped": 0,
            "results_inserted": 0,
            "results_updated": 0,
            "splits_replaced": 0,
            "parse_errors": [],
            "start_time": time.time(),
        }

    def _rate_limit(self):
        time.sleep(random.uniform(MIN_DELAY, MAX_DELAY))

    def _fetch(self, url: str, retries: int = DEFAULT_RETRIES) -> str | None:
        """Fetch URL with retries on 5xx/connection errors. 4xx is not retried."""
        for attempt in range(retries):
            try:
                self._rate_limit()
                resp = self.session.get(url, timeout=30)

                if 400 <= resp.status_code < 500:
                    logger.error(f"Client error {resp.status_code} for {url} — not retrying")
                    return None

                resp.raise_for_status()
                return resp.text
            except requests.RequestException as e:
                if attempt >= retries - 1:
                    break
                base = RETRY_BACKOFF_SCHEDULE[min(attempt, len(RETRY_BACKOFF_SCHEDULE) - 1)]
                wait = base + random.random()
                logger.warning(f"Fetch failed (attempt {attempt + 1}/{retries}): {e}. Retrying in {wait:.1f}s")
                time.sleep(wait)
        logger.error(f"Failed to fetch {url} after {retries} attempts")
        return None

    def discover_events(self) -> list[dict]:
        """
        Two-phase event discovery:

        Phase 1: Parse the Race dropdown (event_main_group) from the start page.
                 This is fully server-rendered and has ALL race names.

        Phase 2: For each race that matches our filters, fetch that race's list page
                 to discover its division event IDs (populated server-side per race).

        Returns list of {group_label, events: [{event_id, label}], season, season_path}
        """
        all_event_groups = []

        # Determine which seasons to scrape based on --since
        since_year = self.since.year
        seasons_to_scrape = []
        for season_label, season_path in sel.SEASONS.items():
            years = [int(y) for y in season_label.split("/")]
            if any(y >= since_year for y in years):
                seasons_to_scrape.append((season_label, season_path))

        for season_label, season_path in seasons_to_scrape:
            # Phase 1: Get all race names from the start page
            logger.info(f"Discovering races for season {season_label} ({season_path})...")
            html = self._fetch(sel.start_page_url(season_path))
            if not html:
                continue

            race_names = parse_race_names(html)
            logger.info(f"  Found {len(race_names)} races in {season_label}")

            # Filter race names by year and event filter
            filtered_races = []
            for race_name in race_names:
                match = re.match(r"(\d{4})\s+(.+)", race_name)
                if not match:
                    continue
                event_year = int(match.group(1))
                if event_year < since_year:
                    continue

                if self.event_filter:
                    race_lower = race_name.lower()
                    if not any(f in race_lower for f in self.event_filter):
                        continue

                filtered_races.append(race_name)

            logger.info(f"  {len(filtered_races)} races match filters")

            # Phase 2: For each race, fetch its page to get division event IDs
            for race_name in filtered_races:
                logger.info(f"  Discovering divisions for: {race_name}")
                race_url = sel.race_list_url(season_path, race_name)
                race_html = self._fetch(race_url)
                if not race_html:
                    continue

                events = parse_event_groups_from_race_page(race_html)
                if not events:
                    logger.warning(f"    No division event IDs found for {race_name}")
                    continue

                logger.info(f"    Found {len(events)} divisions: {[e['label'] for e in events]}")

                all_event_groups.append({
                    "group_label": race_name,
                    "events": events,
                    "season": season_label,
                    "season_path": season_path,
                })

        logger.info(f"Total event groups to scrape: {len(all_event_groups)}")
        return all_event_groups

    def scrape_event_group(self, group: dict) -> None:
        """Scrape all divisions for a single event group (race weekend)."""
        group_label = group["group_label"]
        season = group["season"]
        season_path = group["season_path"]

        logger.info(f"\n{'='*60}")
        logger.info(f"Scraping: {group_label}")
        logger.info(f"{'='*60}")

        # Build a ParsedEvent for this race weekend
        match = re.match(r"(\d{4})\s+(.+)", group_label)
        if not match:
            logger.warning(f"Could not parse event label: {group_label}")
            return

        year = int(match.group(1))
        city_part = match.group(2).strip()
        city = re.sub(
            r"\s+(olympia|excel|rai|messe|convention|center|centre|arena|expo|nec|hall).*$",
            "", city_part, flags=re.IGNORECASE
        ).strip() or city_part

        country = city_to_country(city)
        region = country_to_region(country)
        external_id = re.sub(r"[^a-zA-Z0-9]", "_", group_label).upper()

        # --- Enrichment: get actual event date from HyResult ---
        event_date = date(year, 1, 1)  # placeholder
        if self.db:
            stored_date = self.db.get_event_date(external_id)
            if stored_date and stored_date != f"{year}-01-01":
                # Already have a real date, reuse it
                event_date = date.fromisoformat(stored_date)
                logger.info(f"  Using stored event date: {event_date}")

        if event_date == date(year, 1, 1):
            # Try fetching from HyResult
            hyresult_date = fetch_event_date_from_hyresult(group_label)
            if hyresult_date:
                event_date = hyresult_date
                logger.info(f"  Enriched event date from HyResult: {event_date}")
            else:
                logger.info(f"  Could not determine event date, using placeholder {event_date}")

        # --- Skip check: future event ---
        if event_date > date.today() and event_date != date(year, 1, 1):
            logger.info(f"  SKIPPING — future event (date: {event_date})")
            self.stats["events_skipped_future"] += 1
            return

        parsed_event = ParsedEvent(
            external_id=external_id,
            name=group_label,
            city=city,
            country=country,
            region=region,
            event_date=event_date,
            season=season,
            source_url=sel.start_page_url(season_path),
        )

        # Upsert event
        event_uuid = None
        if not self.dry_run and self.db:
            event_uuid, was_new = self.db.upsert_event(parsed_event)
            action = "Created" if was_new else "Updated"
            logger.info(f"  {action} event: {group_label} → {event_uuid}")
        else:
            logger.info(f"  [DRY RUN] Would upsert event: {group_label}")

        self.stats["events_touched"] += 1

        # --- Skip check: already-scraped completeness (per division) ---
        db_counts: dict[str, int] = {}
        if self.db and not self.force:
            db_counts = self.db.get_event_result_counts(external_id)

        # Process each event entry (each represents a division/format)
        for event_entry in group["events"]:
            event_id = event_entry["event_id"]
            label = event_entry["label"]

            # Determine prefix and base division
            prefix = _get_event_prefix(event_id)
            if prefix is None:
                logger.debug(f"  Skipping {label} ({event_id}) — unrecognized prefix")
                continue

            base = sel.EVENT_PREFIX_TO_DIVISION[prefix]

            # Iterate over gender variants for this division type
            for sex_filter, gender_key in _determine_gender_variants(prefix):
                division_key = _build_division_key(base, gender_key)

                if not self.scrape_all and division_key not in self.divisions:
                    logger.debug(f"  Skipping {division_key} — not in requested divisions")
                    continue

                # Quick result count check from the site
                site_count = self._check_site_result_count(
                    season_path, event_id, sex_filter
                )

                # Skip if 0 results (future event or no data yet)
                if site_count == 0:
                    logger.info(f"  Skipping {division_key} from {label} — 0 results on site")
                    continue

                # Skip if already have ≥95% of results in DB
                if not self.force and division_key in db_counts:
                    db_count = db_counts[division_key]
                    if db_count >= site_count * 0.95:
                        logger.info(
                            f"  Skipping {division_key} from {label} — "
                            f"already have {db_count}/{site_count} results"
                        )
                        self.stats["events_skipped_complete"] += 1
                        continue
                    else:
                        logger.info(
                            f"  Re-scraping {division_key} from {label} — "
                            f"have {db_count}/{site_count} results (incomplete)"
                        )

                logger.info(f"  Scraping {division_key} from {label} ({site_count} results)...")
                self._scrape_division_results(
                    season_path=season_path,
                    event_id=event_id,
                    event_uuid=event_uuid,
                    sex=sex_filter,
                    division_key=division_key,
                    event_prefix=prefix,
                )
                self.stats["divisions_scraped"] += 1

    def _check_site_result_count(
        self, season_path: str, event_id: str, sex: str | None
    ) -> int:
        """Fetch page 1 of a results list to get total result count."""
        url = sel.results_list_url(
            season_path, event_id, page=1, num_results=25, sex=sex
        )
        html = self._fetch(url)
        if not html:
            return 0
        return parse_result_count(html)

    def _scrape_division_results(
        self,
        season_path: str,
        event_id: str,
        event_uuid: str | None,
        sex: str | None,
        division_key: str,
        event_prefix: str = "H_",
    ) -> None:
        """Scrape all result pages for a single event + division (gender)."""
        # First page to get pagination
        url = sel.results_list_url(season_path, event_id, page=1, sex=sex)
        html = self._fetch(url)
        if not html:
            return

        results, total_pages = parse_results_page(html)
        logger.info(f"    Page 1/{total_pages}: {len(results)} results")

        all_list_results = list(results)

        # Fetch remaining pages
        for page in range(2, total_pages + 1):
            url = sel.results_list_url(season_path, event_id, page=page, sex=sex)
            html = self._fetch(url)
            if not html:
                continue
            results, _ = parse_results_page(html)
            logger.info(f"    Page {page}/{total_pages}: {len(results)} results")
            all_list_results.extend(results)

        field_size = len(all_list_results)
        logger.info(f"    Total results for {division_key}: {field_size}")

        # Select the correct segment map for this division type
        segment_map = sel.get_segment_map(event_prefix)

        # Now fetch detail pages for each athlete
        batch: list[ParsedResult] = []
        for i, list_result in enumerate(all_list_results):
            idp = list_result["idp"]
            detail_url = sel.detail_page_url(season_path, idp, event_id)
            detail_html = self._fetch(detail_url)

            if not detail_html:
                self.stats["parse_errors"].append({
                    "type": "fetch_failed",
                    "idp": idp,
                    "event_id": event_id,
                    "event_uuid": event_uuid,
                    "division": division_key,
                    "division_rank": list_result["rank"],
                    "field_size_division": field_size,
                    "season_path": season_path,
                    "event_prefix": event_prefix,
                })
                continue

            detail = parse_athlete_detail(detail_html, segment_map=segment_map)
            if not detail:
                self.stats["parse_errors"].append({
                    "type": "parse_failed",
                    "idp": idp,
                    "event_id": event_id,
                    "division": division_key,
                })
                continue

            parsed = ParsedResult(
                external_result_id=idp,
                athlete_name=detail["name"],
                division_key=division_key,
                age_group=detail["age_group"],
                finish_time_seconds=detail["finish_time_seconds"],
                overall_rank=detail["overall_rank"],
                division_rank=list_result["rank"],
                field_size_division=field_size,
                is_dnf=False,
                splits=detail["splits"],
            )
            batch.append(parsed)

            # Log progress every 25 athletes
            if (i + 1) % 25 == 0:
                logger.info(f"    Fetched {i + 1}/{field_size} detail pages...")

        logger.info(f"    Parsed {len(batch)} results with splits for {division_key}")

        # Write to DB
        if not self.dry_run and self.db and event_uuid and batch:
            db_stats = self.db.upsert_results_batch(event_uuid, batch)
            self.stats["results_inserted"] += db_stats["inserted"]
            self.stats["results_updated"] += db_stats["updated"]
            self.stats["splits_replaced"] += db_stats["splits_replaced"]
            logger.info(
                f"    DB: {db_stats['inserted']} inserted, "
                f"{db_stats['updated']} updated, "
                f"{db_stats['splits_replaced']} splits replaced"
            )
        elif self.dry_run:
            logger.info(f"    [DRY RUN] Would write {len(batch)} results")

    def replay_failures(self, failures_path: Path) -> None:
        """Re-fetch and upsert only the detail pages that failed in a previous run.

        Reads a parse_errors_*.json file written by a prior scrape, groups the
        fetch_failed entries by (event_uuid, division, event_id), re-fetches
        each detail page, and upserts. Records that lack the replay metadata
        (older error files written before that field was added) are skipped
        with a warning.
        """
        from collections import defaultdict

        with open(failures_path) as f:
            failures = json.load(f)

        fetch_failures = [f for f in failures if f.get("type") == "fetch_failed"]
        skipped_old = [f for f in fetch_failures if "event_uuid" not in f or "season_path" not in f]
        replayable = [f for f in fetch_failures if "event_uuid" in f and "season_path" in f]

        logger.info(f"Loaded {len(failures)} error records from {failures_path}")
        logger.info(f"  fetch_failed: {len(fetch_failures)}")
        logger.info(f"  replayable:   {len(replayable)}")
        if skipped_old:
            logger.warning(
                f"  {len(skipped_old)} old-format records missing replay metadata — skipping"
            )

        if not replayable:
            logger.info("Nothing to replay. Done.")
            return

        grouped: dict[tuple, list[dict]] = defaultdict(list)
        for item in replayable:
            key = (
                item["event_uuid"],
                item["division"],
                item["event_id"],
                item["season_path"],
                item.get("event_prefix", "H_"),
            )
            grouped[key].append(item)

        for (event_uuid, division_key, event_id, season_path, event_prefix), items in grouped.items():
            logger.info(
                f"\nReplaying {len(items)} failure(s) for {division_key} on {event_id}"
            )
            segment_map = sel.get_segment_map(event_prefix)
            batch: list[ParsedResult] = []

            for item in items:
                idp = item["idp"]
                detail_url = sel.detail_page_url(season_path, idp, event_id)
                detail_html = self._fetch(detail_url)

                if not detail_html:
                    self.stats["parse_errors"].append({
                        "type": "fetch_failed",
                        "idp": idp,
                        "event_id": event_id,
                        "event_uuid": event_uuid,
                        "division": division_key,
                        "division_rank": item["division_rank"],
                        "field_size_division": item["field_size_division"],
                        "season_path": season_path,
                        "event_prefix": event_prefix,
                    })
                    continue

                detail = parse_athlete_detail(detail_html, segment_map=segment_map)
                if not detail:
                    self.stats["parse_errors"].append({
                        "type": "parse_failed",
                        "idp": idp,
                        "event_id": event_id,
                        "division": division_key,
                    })
                    continue

                batch.append(ParsedResult(
                    external_result_id=idp,
                    athlete_name=detail["name"],
                    division_key=division_key,
                    age_group=detail["age_group"],
                    finish_time_seconds=detail["finish_time_seconds"],
                    overall_rank=detail["overall_rank"],
                    division_rank=item["division_rank"],
                    field_size_division=item["field_size_division"],
                    is_dnf=False,
                    splits=detail["splits"],
                ))

            if not self.dry_run and self.db and event_uuid and batch:
                db_stats = self.db.upsert_results_batch(event_uuid, batch)
                self.stats["results_inserted"] += db_stats["inserted"]
                self.stats["results_updated"] += db_stats["updated"]
                self.stats["splits_replaced"] += db_stats["splits_replaced"]
                logger.info(
                    f"  DB: {db_stats['inserted']} inserted, "
                    f"{db_stats['updated']} updated, "
                    f"{db_stats['splits_replaced']} splits replaced"
                )
            elif self.dry_run:
                logger.info(f"  [DRY RUN] Would write {len(batch)} replayed results")

    def print_summary(self) -> None:
        elapsed = time.time() - self.stats["start_time"]
        logger.info(f"\n{'='*60}")
        logger.info("SCRAPE SUMMARY")
        logger.info(f"{'='*60}")
        logger.info(f"Events touched:       {self.stats['events_touched']}")
        logger.info(f"Skipped (future):     {self.stats['events_skipped_future']}")
        logger.info(f"Skipped (complete):   {self.stats['events_skipped_complete']}")
        logger.info(f"Divisions scraped:    {self.stats['divisions_scraped']}")
        logger.info(f"Results inserted:     {self.stats['results_inserted']}")
        logger.info(f"Results updated:      {self.stats['results_updated']}")
        logger.info(f"Splits replaced:      {self.stats['splits_replaced']}")
        logger.info(f"Parse errors:         {len(self.stats['parse_errors'])}")
        logger.info(f"Wall-clock time:      {elapsed:.1f}s")

        if self.stats["parse_errors"]:
            log_dir = Path(__file__).parent / "logs"
            log_dir.mkdir(exist_ok=True)
            log_file = log_dir / f"scrape_errors_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            with open(log_file, "w") as f:
                json.dump(self.stats["parse_errors"], f, indent=2)
            logger.info(f"Parse errors written to: {log_file}")


@click.command()
@click.option("--since", required=False, type=click.DateTime(formats=["%Y-%m-%d"]),
              help="Scrape events from this date forward (YYYY-MM-DD). Required unless --retry-failed is set.")
@click.option("--divisions", default="all",
              help="Comma-separated division keys to scrape, or 'all' for everything")
@click.option("--events", default=None,
              help="Comma-separated event name filters (e.g. 'London,Berlin')")
@click.option("--pick", is_flag=True,
              help="Interactive mode: discover events then choose which to scrape")
@click.option("--dry-run", is_flag=True, help="Parse + print, don't write to DB")
@click.option("--force", is_flag=True, help="Re-scrape all events even if already complete in DB")
@click.option("--refresh-mv/--no-refresh-mv", default=True,
              help="Refresh materialized view after scraping")
@click.option("--retry-failed", "retry_failed", default=None,
              type=click.Path(exists=True, dir_okay=False),
              help="Replay only the dropped detail-page fetches from a previous run's "
                   "parse_errors_*.json. Skips event discovery entirely.")
@click.option("--env", "env_file", default="local",
              type=click.Choice(["local", "prod"]),
              help="Environment to use: 'local' reads ../.env.local, 'prod' reads ../.env.prod")
@click.option("--db-url", default=None,
              help="Explicit Postgres connection string (overrides --env)")
def main(
    since: datetime | None,
    divisions: str,
    events: str | None,
    pick: bool,
    dry_run: bool,
    force: bool,
    refresh_mv: bool,
    retry_failed: str | None,
    env_file: str,
    db_url: str | None,
):
    """Scrape HYROX public results into the ShredTrack database."""

    if since is None and not retry_failed:
        raise click.UsageError("--since is required unless --retry-failed is provided")

    # Set up logging to console + file
    setup_logging(env_file)

    # Resolve DB URL: explicit flag > env file > environment variable
    if not db_url:
        repo_root = Path(__file__).parent.parent
        env_path = repo_root / (".env.local" if env_file == "local" else ".env.prod")

        if env_path.exists():
            env_vars = dotenv_values(env_path)
            db_url = env_vars.get("DATABASE_URL")
            if db_url:
                logger.info(f"Using DATABASE_URL from {env_path.name}")
            else:
                logger.warning(f"No DATABASE_URL found in {env_path.name}")
        else:
            logger.warning(f"{env_path.name} not found at {env_path}")

        # Fallback to environment variable
        if not db_url:
            db_url = os.environ.get("DATABASE_URL") or os.environ.get("SUPABASE_DB_URL")

    if not dry_run and not db_url:
        logger.error(
            "No database URL found. Either:\n"
            "  1. Ensure DATABASE_URL is set in ../.env.local (default)\n"
            "  2. Pass --env prod to read from ../.env.prod\n"
            "  3. Pass --db-url explicitly\n"
            "  4. Use --dry-run to skip DB writes"
        )
        sys.exit(1)

    division_list = [d.strip() for d in divisions.split(",")]
    event_filter = [e.strip() for e in events.split(",")] if events else None

    db = HyroxDB(db_url) if db_url and not dry_run else None

    # In replay mode --since is unused — pass a placeholder
    effective_since = (
        since.date() if isinstance(since, datetime)
        else since if since is not None
        else date(1970, 1, 1)
    )

    scraper = HyroxScraper(
        db=db,
        since=effective_since,
        divisions=division_list,
        event_filter=event_filter,
        dry_run=dry_run,
        force=force,
    )

    # Replay-only mode: skip discovery, re-fetch the dropped detail pages, and exit.
    if retry_failed:
        scraper.replay_failures(Path(retry_failed))
        if refresh_mv and db and not dry_run:
            try:
                db.refresh_materialized_view()
            except Exception as e:
                logger.error(f"Failed to refresh materialized view: {e}")
        scraper.print_summary()
        return

    # Step 1: Discover events
    event_groups = scraper.discover_events()

    if not event_groups:
        logger.info("No events found matching criteria. Done.")
        return

    # Step 1.5: Interactive selection (--pick)
    if pick:
        click.echo(f"\nFound {len(event_groups)} events:\n")
        for i, group in enumerate(event_groups, 1):
            num_divs = len(group["events"])
            click.echo(f"  {i:3d}. {group['group_label']}  ({num_divs} divisions, season {group['season']})")
        click.echo()
        click.echo("Enter event numbers to scrape (comma-separated, ranges with dash, or 'all'):")
        click.echo("  Examples: 1,3,5  or  2-7  or  1,4-6,10  or  all")
        selection = click.prompt("Selection", type=str)

        if selection.strip().lower() == "all":
            pass  # keep all event_groups
        else:
            selected_indices: set[int] = set()
            for part in selection.split(","):
                part = part.strip()
                if "-" in part:
                    start_s, end_s = part.split("-", 1)
                    start_i, end_i = int(start_s.strip()), int(end_s.strip())
                    selected_indices.update(range(start_i, end_i + 1))
                else:
                    selected_indices.add(int(part))

            event_groups = [
                g for i, g in enumerate(event_groups, 1) if i in selected_indices
            ]
            click.echo(f"\nSelected {len(event_groups)} event(s) to scrape.\n")

        if not event_groups:
            logger.info("No events selected. Done.")
            return

    # Step 2: Scrape each event
    for group in event_groups:
        try:
            scraper.scrape_event_group(group)
        except Exception as e:
            logger.error(f"Error scraping {group['group_label']}: {e}", exc_info=True)
            scraper.stats["parse_errors"].append({
                "type": "event_error",
                "event": group["group_label"],
                "error": str(e),
            })

    # Step 3: Refresh materialized view
    if refresh_mv and db and not dry_run:
        try:
            db.refresh_materialized_view()
        except Exception as e:
            logger.error(f"Failed to refresh materialized view: {e}")

    # Step 4: Print summary
    scraper.print_summary()

    # Print DB counts if available
    if db and not dry_run:
        counts = db.get_result_counts()
        logger.info(f"\nDB result counts by division:")
        for div, count in sorted(counts.items()):
            logger.info(f"  {div}: {count}")


if __name__ == "__main__":
    main()
