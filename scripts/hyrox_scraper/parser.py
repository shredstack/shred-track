"""
HTML parsing for HYROX results pages.

Extracts events, results, and splits from results.hyrox.com HTML.
All selectors are imported from selectors.py for single-file drift fixes.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import date
from urllib.parse import parse_qs, urlparse

import requests
from bs4 import BeautifulSoup, Tag

from . import selectors as sel
from .models import ParsedEvent, ParsedResult, ParsedSplit, city_to_country, country_to_region

logger = logging.getLogger(__name__)


def parse_time_to_seconds(time_str: str) -> int | None:
    """Parse HH:MM:SS or MM:SS or H:MM:SS to total seconds."""
    time_str = time_str.strip()
    if not time_str or time_str == "--" or time_str == "DNF":
        return None
    parts = time_str.split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        elif len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
    except ValueError:
        return None
    return None


# ---------------------------------------------------------------------------
# Event discovery
# ---------------------------------------------------------------------------

def parse_race_names(html: str) -> list[str]:
    """
    Phase 1: Parse the Race dropdown (event_main_group) from the start page.
    This is fully server-rendered and contains ALL race names (e.g. "2026 Las Vegas").

    The Division dropdown is only populated for the currently-selected race via AJAX,
    so we can't get event IDs from the start page alone.
    """
    soup = BeautifulSoup(html, "html.parser")
    races = []
    for opt in soup.select(sel.SEL_RACE_DROPDOWN):
        value = opt.get("value", "").strip()
        if value:
            races.append(value)
    return races


def parse_event_groups_from_race_page(html: str) -> list[dict]:
    """
    Phase 2: Parse a race-specific list page to extract that race's division event IDs.
    When we fetch a page with `event_main_group=2026+Las+Vegas`, the Division dropdown
    is populated with that race's optgroups/options.

    Returns list of dicts: [{"event_id": "H_...", "label": "HYROX - Saturday"}, ...]
    """
    soup = BeautifulSoup(html, "html.parser")
    events = []

    # First try optgroups (grouped by race day)
    for optgroup in soup.select(sel.SEL_EVENT_OPTGROUPS):
        for opt in optgroup.find_all("option"):
            event_id = opt.get("value", "").strip()
            label = opt.get_text(strip=True)
            if event_id and label:
                events.append({"event_id": event_id, "label": label})

    # Fallback: also check top-level options in the event dropdown
    if not events:
        for opt in soup.select(sel.SEL_EVENT_DROPDOWN):
            event_id = opt.get("value", "").strip()
            label = opt.get_text(strip=True)
            if event_id and label:
                events.append({"event_id": event_id, "label": label})

    return events


def parse_result_count(html: str) -> int:
    """Parse the total result count from a results list page header (e.g., '> 600 Results')."""
    soup = BeautifulSoup(html, "html.parser")
    count_el = soup.select_one(sel.SEL_RESULT_COUNT)
    if not count_el:
        return 0
    text = count_el.get_text(strip=True)
    # Format: "> 600 Results" or "600 Results"
    match = re.search(r"(\d[\d,]*)", text.replace(",", ""))
    if match:
        return int(match.group(1))
    return 0


def fetch_event_date_from_hyresult(race_name: str, season_number: int = 8) -> date | None:
    """
    Fetch actual event start date from HyResult's JSON-LD structured data.

    race_name: e.g., "2026 Las Vegas"
    Returns: start date, or None on failure
    """
    match = re.match(r"(\d{4})\s+(.+)", race_name)
    if not match:
        return None

    year = match.group(1)
    city = match.group(2).strip().lower()
    # Clean venue suffixes before slugifying
    city = re.sub(
        r"\s*[-–]\s*(youngstars|championship).*$", "", city, flags=re.IGNORECASE
    ).strip()
    city = re.sub(
        r"\s+(olympia|excel|rai|messe|convention|center|centre|arena|expo|nec|hall).*$",
        "", city, flags=re.IGNORECASE
    ).strip()
    slug = re.sub(r"[^a-z0-9]+", "-", city).strip("-")

    url = f"https://www.hyresult.com/event/s{season_number}-{year}-{slug}"

    try:
        resp = requests.get(url, timeout=10, headers={
            "User-Agent": "ShredTrack Research Script (shredstacksarah@gmail.com)"
        })
        if resp.status_code != 200:
            logger.debug(f"HyResult returned {resp.status_code} for {url}")
            return None

        soup = BeautifulSoup(resp.text, "html.parser")
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(script.string)
                start_date = data.get("startDate")
                if start_date:
                    return date.fromisoformat(start_date)
            except (json.JSONDecodeError, ValueError, TypeError):
                continue

        logger.debug(f"No JSON-LD startDate found at {url}")
        return None
    except requests.RequestException as e:
        logger.debug(f"Failed to fetch HyResult date for {race_name}: {e}")
        return None


def event_group_to_parsed_event(
    group: dict,
    season: str,
    season_path: str,
) -> ParsedEvent | None:
    """
    Convert an event group (a race weekend) into a ParsedEvent.
    We use the group label (e.g. "2026 London Olympia") for the event name.
    """
    label = group["group_label"]  # e.g. "2026 London Olympia"

    # Extract year and city from label
    match = re.match(r"(\d{4})\s+(.+)", label)
    if not match:
        logger.warning(f"Could not parse event group label: {label}")
        return None

    year = int(match.group(1))
    city_part = match.group(2).strip()

    # Clean city name (remove venue suffixes like "Olympia", "ExCeL", etc.)
    city = re.sub(r"\s+(olympia|excel|rai|messe|convention|center|centre|arena|expo|nec|hall).*$",
                  "", city_part, flags=re.IGNORECASE).strip()
    if not city:
        city = city_part

    country = city_to_country(city)
    region = country_to_region(country)

    # Use the first event's ID prefix as the external_id for the race weekend
    first_event_id = group["events"][0]["event_id"] if group["events"] else label
    # Derive a stable external ID from the group label
    external_id = re.sub(r"[^a-zA-Z0-9]", "_", label).upper()

    return ParsedEvent(
        external_id=external_id,
        name=label,
        city=city,
        country=country,
        region=region,
        event_date=date(year, 1, 1),  # Placeholder — refined from detail pages if available
        season=season,
        source_url=sel.start_page_url(season_path),
    )


# ---------------------------------------------------------------------------
# Results list parsing
# ---------------------------------------------------------------------------

def parse_results_page(html: str) -> tuple[list[dict], int]:
    """
    Parse a results list page.

    Returns:
        (results, total_pages) where each result is a dict with:
        {idp, name, rank, age_class, time_str, nationality}
    """
    soup = BeautifulSoup(html, "html.parser")
    results = []

    for row in soup.select(sel.SEL_RESULT_ROW):
        result = _parse_result_row(row)
        if result:
            results.append(result)

    total_pages = _parse_total_pages(soup)
    return results, total_pages


def _parse_result_row(row: Tag) -> dict | None:
    """Parse a single result row from the list page."""
    # Name + detail link
    name_link = row.select_one(sel.SEL_ROW_NAME_LINK)
    if not name_link:
        return None

    name = name_link.get_text(strip=True)
    href = name_link.get("href", "")

    # Extract athlete idp from href
    parsed = urlparse(str(href))
    params = parse_qs(parsed.query)
    idp = params.get("idp", [None])[0]
    if not idp:
        # Try from full URL params
        if "idp=" in str(href):
            idp_match = re.search(r"idp=([A-Za-z0-9]+)", str(href))
            if idp_match:
                idp = idp_match.group(1)
    if not idp:
        return None

    # Rank
    rank_el = row.select_one(sel.SEL_ROW_RANK_PRIMARY)
    rank_str = rank_el.get_text(strip=True) if rank_el else "0"
    try:
        rank = int(rank_str.replace(".", ""))
    except ValueError:
        rank = 0

    # Age group rank
    ag_rank_el = row.select_one(sel.SEL_ROW_RANK_SECONDARY)
    ag_rank_str = ag_rank_el.get_text(strip=True) if ag_rank_el else ""

    # Time
    time_el = row.select_one(sel.SEL_ROW_TIME)
    time_str = time_el.get_text(strip=True) if time_el else ""

    # Age class
    age_el = row.select_one(sel.SEL_ROW_AGE_CLASS)
    age_class = age_el.get_text(strip=True) if age_el else None

    # Nationality
    nat_el = row.select_one(sel.SEL_ROW_NATIONALITY)
    nationality = nat_el.get_text(strip=True) if nat_el else ""

    return {
        "idp": idp,
        "name": name,
        "rank": rank,
        "age_class": age_class,
        "time_str": time_str,
        "nationality": nationality,
    }


def _parse_total_pages(soup: BeautifulSoup) -> int:
    """Extract total page count from pagination."""
    pagination = soup.select(sel.SEL_PAGINATION_ITEMS)
    if not pagination:
        return 1

    max_page = 1
    for li in pagination:
        a = li.find("a")
        if a:
            text = a.get_text(strip=True)
            try:
                page_num = int(text)
                max_page = max(max_page, page_num)
            except ValueError:
                continue
    return max_page


# ---------------------------------------------------------------------------
# Athlete detail / splits parsing
# ---------------------------------------------------------------------------

def parse_athlete_detail(html: str, segment_map: list[dict] | None = None) -> dict | None:
    """
    Parse an athlete detail page for all split times.

    Returns dict:
    {
        "name": str,
        "bib": str,
        "age_group": str,
        "nationality": str,
        "race_name": str,
        "division_label": str,
        "overall_rank": int,
        "finish_time_seconds": int,
        "splits": [ParsedSplit, ...],
        "penalty_seconds": int,
        "bonus_seconds": int,
    }
    """
    soup = BeautifulSoup(html, "html.parser")

    # Name
    name_el = soup.select_one(sel.SEL_DETAIL_NAME)
    if not name_el:
        return None
    name = name_el.get_text(strip=True)

    # Bib
    bib_el = soup.select_one(sel.SEL_DETAIL_BIB)
    bib = bib_el.get_text(strip=True) if bib_el else ""

    # Age group
    ag_el = soup.select_one(sel.SEL_DETAIL_AGE_GROUP)
    age_group = ag_el.get_text(strip=True) if ag_el else None

    # Nationality
    nat_el = soup.select_one(sel.SEL_DETAIL_NATIONALITY)
    nationality = nat_el.get_text(strip=True) if nat_el else ""

    # Race info
    race_el = soup.select_one(sel.SEL_DETAIL_RACE)
    race_name = race_el.get_text(strip=True) if race_el else ""

    div_el = soup.select_one(sel.SEL_DETAIL_DIVISION)
    division_label = div_el.get_text(strip=True) if div_el else ""

    # Ranks
    rank_el = soup.select_one(sel.SEL_DETAIL_RANK_OVERALL)
    rank_str = rank_el.get_text(strip=True) if rank_el else "0"
    try:
        overall_rank = int(rank_str.replace(".", "").strip())
    except ValueError:
        overall_rank = 0

    # Finish time
    finish_el = soup.select_one(sel.SEL_DETAIL_FINISH_TIME)
    finish_str = finish_el.get_text(strip=True) if finish_el else ""
    finish_seconds = parse_time_to_seconds(finish_str)

    if finish_seconds is None:
        return None  # DNF or unparseable

    # Splits
    active_segment_map = segment_map if segment_map is not None else sel.SEGMENT_MAP
    splits: list[ParsedSplit] = []
    for seg in active_segment_map:
        selector = sel.SPLIT_SELECTORS.get(seg["label"])
        if not selector:
            continue

        el = soup.select_one(selector)
        if not el:
            continue

        time_str = el.get_text(strip=True)
        time_secs = parse_time_to_seconds(time_str)
        if time_secs is None:
            continue

        splits.append(ParsedSplit(
            segment_order=seg["order"],
            segment_type=seg["type"],
            segment_label=seg["label"],
            station_name=seg["station_name"],
            run_number=seg["run_number"],
            time_seconds=time_secs,
        ))

    # Penalties / bonuses
    penalty_el = soup.select_one(sel.SEL_DETAIL_PENALTY)
    penalty_str = penalty_el.get_text(strip=True) if penalty_el else ""
    penalty_seconds = parse_time_to_seconds(penalty_str) or 0

    bonus_el = soup.select_one(sel.SEL_DETAIL_BONUS)
    bonus_str = bonus_el.get_text(strip=True) if bonus_el else ""
    bonus_seconds = parse_time_to_seconds(bonus_str) or 0

    return {
        "name": name,
        "bib": bib,
        "age_group": age_group,
        "nationality": nationality,
        "race_name": race_name,
        "division_label": division_label,
        "overall_rank": overall_rank,
        "finish_time_seconds": finish_seconds,
        "splits": splits,
        "penalty_seconds": penalty_seconds,
        "bonus_seconds": bonus_seconds,
    }
