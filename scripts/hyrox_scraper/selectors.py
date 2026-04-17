from __future__ import annotations

"""
CSS selectors and URL patterns for the HYROX results site (results.hyrox.com).

The site is powered by Mika Timing. All data is server-rendered HTML — no JS
execution required. If selectors drift after a site update, fix them here.
"""

# ---------------------------------------------------------------------------
# Base URLs
# ---------------------------------------------------------------------------
BASE_URL = "https://results.hyrox.com"

# Seasons mapped to URL path segments. Season 8 = 2025/2026.
SEASONS = {
    "2024/2025": "season-7",
    "2025/2026": "season-8",
    "2023/2024": "season-6",
}

# Default to current season
CURRENT_SEASON_PATH = "season-8"


def season_url(season_path: str = CURRENT_SEASON_PATH) -> str:
    return f"{BASE_URL}/{season_path}/"


# ---------------------------------------------------------------------------
# URL query parameter builders
# ---------------------------------------------------------------------------

def start_page_url(season_path: str = CURRENT_SEASON_PATH) -> str:
    """Event listing / search form."""
    return f"{season_url(season_path)}?pid=start&pidp=ranking_nav"


def race_list_url(
    season_path: str,
    race_name: str,
) -> str:
    """Fetch the list page for a specific race to discover its division event IDs."""
    from urllib.parse import quote_plus
    return (
        f"{season_url(season_path)}?pid=list&pidp=ranking_nav"
        f"&event_main_group={quote_plus(race_name)}&num_results=25&page=1&lang=EN_CAP"
    )


def results_list_url(
    season_path: str,
    event_id: str,
    page: int = 1,
    num_results: int = 100,
    sex: str | None = None,
) -> str:
    """Paginated results list for a specific event/division."""
    url = (
        f"{season_url(season_path)}?pid=list&pidp=ranking_nav"
        f"&event={event_id}&num_results={num_results}&page={page}&lang=EN_CAP"
    )
    if sex:
        url += f"&search%5Bsex%5D={sex}"
    return url


def detail_page_url(
    season_path: str,
    athlete_idp: str,
    event_id: str,
) -> str:
    """Individual athlete detail page with all splits."""
    return (
        f"{season_url(season_path)}?content=detail&fpid=list&pid=list"
        f"&idp={athlete_idp}&lang=EN_CAP&event={event_id}"
        f"&pidp=ranking_nav&search_event={event_id}"
    )


# ---------------------------------------------------------------------------
# Event prefix → division base mapping
# ---------------------------------------------------------------------------

# Maps event ID prefix to a division base key. Gender is appended separately
# based on the sex filter or division label parsing.
EVENT_PREFIX_TO_DIVISION = {
    "H_":    "open",              # HYROX (Open singles)
    "HPRO_": "pro",               # HYROX Pro (Pro singles)
    "HE_":   "elite_15",          # HYROX Elite 15
    "HD_":   "doubles_open",      # HYROX Doubles (Open)
    "HDP_":  "doubles_pro",       # HYROX Pro Doubles
    "HDE_":  "elite_15_doubles",  # HYROX Elite 15 Doubles
    "HMR_":  "relay",             # HYROX Team Relay
    "HCR_":  "corporate_relay",   # HYROX Corporate Relay
    "HA_":   "adaptive",          # HYROX Adaptive
    "THD_":  "company_challenge", # HYROX Company Challenge
    "HY1_":  "youngstars_8_9",    # HYROX Youngstars 8-9
    "HY2_":  "youngstars_10_11",  # HYROX Youngstars 10-11
    "HY3_":  "youngstars_12_13",  # HYROX Youngstars 12-13
    "HY4_":  "youngstars_14_15",  # HYROX Youngstars 14-15
}

# Divisions that support Men/Women/Mixed genders (team formats)
MIXED_GENDER_PREFIXES = {"HD_", "HDP_", "HDE_", "HMR_", "HCR_", "THD_"}

# Divisions that only have Men/Women (no mixed)
GENDERED_ONLY_PREFIXES = {
    "H_", "HPRO_", "HE_", "HA_",
    "HY1_", "HY2_", "HY3_", "HY4_",
}

# Youngstars prefixes (need different segment maps)
YOUNGSTARS_PREFIXES = {"HY1_", "HY2_", "HY3_", "HY4_"}


# ---------------------------------------------------------------------------
# CSS selectors — results list page
# ---------------------------------------------------------------------------

# Race dropdown (fully server-rendered — has ALL race names)
SEL_RACE_DROPDOWN = "select[name='event_main_group'] option"

# Division dropdown (only populated for the currently selected race)
SEL_EVENT_DROPDOWN = "select[name='event'] option"
SEL_EVENT_OPTGROUPS = "select[name='event'] optgroup"

# Results list
SEL_RESULT_COUNT = "span.list-info__text.str_num"
SEL_RESULT_ROW = "li.list-group-item.row"

# Fields within a result row
SEL_ROW_RANK_PRIMARY = "div.list-field.type-place.place-primary"
SEL_ROW_RANK_SECONDARY = "div.list-field.type-place.place-secondary"
SEL_ROW_NAME_LINK = "h4.list-field > a"
SEL_ROW_NATIONALITY = "div.list-field.type-nation_flag span.nation__abbr"
SEL_ROW_AGE_CLASS = "div.list-field.type-age_class"
SEL_ROW_TIME = "div.list-field.type-time"

# Pagination
SEL_PAGINATION = "div.pull-right.pages ul.pagination"
SEL_PAGINATION_ITEMS = "div.pull-right.pages ul.pagination li"

# ---------------------------------------------------------------------------
# CSS selectors — athlete detail page
# ---------------------------------------------------------------------------

# Participant info
SEL_DETAIL_NAME = "td.f-__fullname"
SEL_DETAIL_BIB = "td.f-start_no_text"
SEL_DETAIL_AGE_GROUP = "td.f-_type_age_class"
SEL_DETAIL_NATIONALITY = "td.f-__nation"

# Race info
SEL_DETAIL_RACE = "td.f-__meeting"
SEL_DETAIL_DIVISION = "td.f-__event"

# Ranks
SEL_DETAIL_RANK_OVERALL = "td.f-place_all"
SEL_DETAIL_RANK_AG = "td.f-place_age"

# Overall time
SEL_DETAIL_FINISH_TIME = "td.f-time_finish_netto"

# Workout summary splits — CSS class pattern: td.f-time_{NN}
# Runs: time_01 through time_08
# Stations: time_11 through time_18
# Roxzone total: time_60
# Run total: time_49
# Best run: time_50
SPLIT_SELECTORS = {
    "Run 1": "td.f-time_01",
    "SkiErg": "td.f-time_11",
    "Run 2": "td.f-time_02",
    "Sled Push": "td.f-time_12",
    "Run 3": "td.f-time_03",
    "Sled Pull": "td.f-time_13",
    "Run 4": "td.f-time_04",
    "Burpee Broad Jumps": "td.f-time_14",
    "Run 5": "td.f-time_05",
    "Rowing": "td.f-time_15",
    "Run 6": "td.f-time_06",
    "Farmers Carry": "td.f-time_16",
    "Run 7": "td.f-time_07",
    "Sandbag Lunges": "td.f-time_17",
    "Run 8": "td.f-time_08",
    "Wall Balls": "td.f-time_18",
    "Roxzone Total": "td.f-time_60",
}

# Penalties / bonuses
SEL_DETAIL_BONUS = "td.f-gimmick_04"
SEL_DETAIL_PENALTY = "td.f-gimmick_01"


# ---------------------------------------------------------------------------
# Segment metadata for DB insertion — standard adult format (8 runs + 8 stations)
# Used for: Singles, Pro, Elite 15, Doubles, Relay, Corporate, Adaptive
# ---------------------------------------------------------------------------

SEGMENT_MAP: list[dict] = [
    {"order": 0,  "label": "Run 1",               "type": "run",     "station_name": None,                  "run_number": 1},
    {"order": 1,  "label": "SkiErg",               "type": "station", "station_name": "SkiErg",              "run_number": None},
    {"order": 2,  "label": "Run 2",                "type": "run",     "station_name": None,                  "run_number": 2},
    {"order": 3,  "label": "Sled Push",             "type": "station", "station_name": "Sled Push",           "run_number": None},
    {"order": 4,  "label": "Run 3",                "type": "run",     "station_name": None,                  "run_number": 3},
    {"order": 5,  "label": "Sled Pull",             "type": "station", "station_name": "Sled Pull",           "run_number": None},
    {"order": 6,  "label": "Run 4",                "type": "run",     "station_name": None,                  "run_number": 4},
    {"order": 7,  "label": "Burpee Broad Jumps",    "type": "station", "station_name": "Burpee Broad Jumps",  "run_number": None},
    {"order": 8,  "label": "Run 5",                "type": "run",     "station_name": None,                  "run_number": 5},
    {"order": 9,  "label": "Rowing",                "type": "station", "station_name": "Rowing",              "run_number": None},
    {"order": 10, "label": "Run 6",                "type": "run",     "station_name": None,                  "run_number": 6},
    {"order": 11, "label": "Farmers Carry",         "type": "station", "station_name": "Farmers Carry",       "run_number": None},
    {"order": 12, "label": "Run 7",                "type": "run",     "station_name": None,                  "run_number": 7},
    {"order": 13, "label": "Sandbag Lunges",        "type": "station", "station_name": "Sandbag Lunges",      "run_number": None},
    {"order": 14, "label": "Run 8",                "type": "run",     "station_name": None,                  "run_number": 8},
    {"order": 15, "label": "Wall Balls",            "type": "station", "station_name": "Wall Balls",          "run_number": None},
    {"order": 16, "label": "Roxzone Total",         "type": "roxzone", "station_name": None,                  "run_number": None},
]


# ---------------------------------------------------------------------------
# Youngstars segment maps — different run structure per age group
# These are tentative — the actual detail page HTML may use different CSS
# selectors. Once verified against real Youngstars results pages, the
# SPLIT_SELECTORS may need a youngstars-specific variant.
#
# For now, we attempt to parse using the same td.f-time_XX selectors.
# If a selector is missing, the split is simply omitted (graceful degradation).
# ---------------------------------------------------------------------------

# Youngstars 8-9 and 10-11: 3 runs, 8 stations grouped between runs
# Format: Run → [4 stations] → Run → [3 stations] → Run → [Wall Balls]
YOUNGSTARS_SEGMENT_MAP_3_RUN: list[dict] = [
    {"order": 0,  "label": "Run 1",          "type": "run",     "station_name": None,             "run_number": 1},
    {"order": 1,  "label": "SkiErg",          "type": "station", "station_name": "SkiErg",         "run_number": None},
    {"order": 2,  "label": "Sled Push",        "type": "station", "station_name": "Sled Push",      "run_number": None},
    {"order": 3,  "label": "Sled Pull",        "type": "station", "station_name": "Sled Pull",      "run_number": None},
    {"order": 4,  "label": "Burpee Broad Jumps", "type": "station", "station_name": "Burpee Broad Jumps", "run_number": None},
    {"order": 5,  "label": "Run 2",           "type": "run",     "station_name": None,             "run_number": 2},
    {"order": 6,  "label": "Rowing",           "type": "station", "station_name": "Rowing",         "run_number": None},
    {"order": 7,  "label": "Farmers Carry",    "type": "station", "station_name": "Farmers Carry",  "run_number": None},
    {"order": 8,  "label": "Sandbag Lunges",   "type": "station", "station_name": "Sandbag Lunges", "run_number": None},
    {"order": 9,  "label": "Run 3",           "type": "run",     "station_name": None,             "run_number": 3},
    {"order": 10, "label": "Wall Balls",       "type": "station", "station_name": "Wall Balls",     "run_number": None},
]

# Youngstars 12-13: 2 runs, 8 stations grouped between runs
# Format: Run → [7 stations] → Run → [Wall Balls]
YOUNGSTARS_SEGMENT_MAP_2_RUN: list[dict] = [
    {"order": 0,  "label": "Run 1",           "type": "run",     "station_name": None,             "run_number": 1},
    {"order": 1,  "label": "SkiErg",           "type": "station", "station_name": "SkiErg",         "run_number": None},
    {"order": 2,  "label": "Sled Push",         "type": "station", "station_name": "Sled Push",      "run_number": None},
    {"order": 3,  "label": "Sled Pull",         "type": "station", "station_name": "Sled Pull",      "run_number": None},
    {"order": 4,  "label": "Burpee Broad Jumps", "type": "station", "station_name": "Burpee Broad Jumps", "run_number": None},
    {"order": 5,  "label": "Rowing",            "type": "station", "station_name": "Rowing",         "run_number": None},
    {"order": 6,  "label": "Farmers Carry",     "type": "station", "station_name": "Farmers Carry",  "run_number": None},
    {"order": 7,  "label": "Sandbag Lunges",    "type": "station", "station_name": "Sandbag Lunges", "run_number": None},
    {"order": 8,  "label": "Run 2",            "type": "run",     "station_name": None,             "run_number": 2},
    {"order": 9,  "label": "Wall Balls",        "type": "station", "station_name": "Wall Balls",     "run_number": None},
]

# Youngstars 14-15: Same 8-run format as adults
YOUNGSTARS_SEGMENT_MAP_8_RUN = SEGMENT_MAP  # identical to adult


def get_segment_map(event_prefix: str) -> list[dict]:
    """Return the correct segment map for a given event prefix."""
    if event_prefix in ("HY1_", "HY2_"):
        return YOUNGSTARS_SEGMENT_MAP_3_RUN
    elif event_prefix == "HY3_":
        return YOUNGSTARS_SEGMENT_MAP_2_RUN
    # HY4_ and all adult divisions use the standard map
    return SEGMENT_MAP
