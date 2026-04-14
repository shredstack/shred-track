"""Pydantic models for parsed HYROX data — validated before DB insertion."""

from __future__ import annotations

import hashlib
from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator


class ParsedEvent(BaseModel):
    external_id: str
    name: str
    city: str
    country: str  # ISO-2
    region: str   # EMEA | NA | APAC
    event_date: date
    season: str
    source_url: str | None = None

    @field_validator("region")
    @classmethod
    def validate_region(cls, v: str) -> str:
        if v not in ("EMEA", "NA", "APAC"):
            raise ValueError(f"Invalid region: {v}")
        return v


class ParsedSplit(BaseModel):
    segment_order: int
    segment_type: str  # run | station | roxzone
    segment_label: str
    station_name: str | None = None
    run_number: int | None = None
    time_seconds: int


class ParsedResult(BaseModel):
    external_result_id: str
    athlete_name: str  # used only for hashing, never stored
    division_key: str
    age_group: str | None = None
    finish_time_seconds: int
    overall_rank: int
    division_rank: int
    field_size_division: int = 0
    is_dnf: bool = False
    splits: list[ParsedSplit] = Field(default_factory=list)

    @property
    def external_athlete_hash(self) -> str:
        """SHA-256 of normalized name + division — not reversible."""
        raw = f"{self.athlete_name.strip().lower()}|{self.division_key}|{self.external_result_id}"
        return hashlib.sha256(raw.encode()).hexdigest()

    @property
    def percentile(self) -> float:
        if self.field_size_division <= 0:
            return 50.0
        return round((1 - (self.division_rank - 1) / self.field_size_division) * 100, 2)


# Country → region mapping
COUNTRY_REGION: dict[str, str] = {
    # EMEA
    "GBR": "EMEA", "DEU": "EMEA", "FRA": "EMEA", "ESP": "EMEA", "ITA": "EMEA",
    "NLD": "EMEA", "BEL": "EMEA", "AUT": "EMEA", "CHE": "EMEA", "POL": "EMEA",
    "PRT": "EMEA", "IRL": "EMEA", "GRC": "EMEA", "CZE": "EMEA", "HUN": "EMEA",
    "SWE": "EMEA", "NOR": "EMEA", "DNK": "EMEA", "FIN": "EMEA", "LUX": "EMEA",
    "ZAF": "EMEA", "ARE": "EMEA", "SAU": "EMEA", "ISR": "EMEA", "TUR": "EMEA",
    "QAT": "EMEA", "BHR": "EMEA", "KWT": "EMEA", "OMN": "EMEA",
    # NA
    "USA": "NA", "CAN": "NA", "MEX": "NA",
    # APAC
    "AUS": "NA", "NZL": "APAC", "JPN": "APAC", "KOR": "APAC", "SGP": "APAC",
    "HKG": "APAC", "CHN": "APAC", "TWN": "APAC", "THA": "APAC", "MYS": "APAC",
    "IND": "APAC", "IDN": "APAC", "PHL": "APAC", "VNM": "APAC",
}

# Fix AUS — should be APAC
COUNTRY_REGION["AUS"] = "APAC"


def country_to_region(country_code: str) -> str:
    return COUNTRY_REGION.get(country_code.upper(), "EMEA")


# City → country mapping for known HYROX venues
CITY_COUNTRY: dict[str, str] = {
    "london": "GBR", "manchester": "GBR", "birmingham": "GBR", "edinburgh": "GBR",
    "berlin": "DEU", "hamburg": "DEU", "munich": "DEU", "cologne": "DEU",
    "frankfurt": "DEU", "düsseldorf": "DEU", "hannover": "DEU", "stuttgart": "DEU",
    "karlsruhe": "DEU", "leipzig": "DEU", "dortmund": "DEU",
    "paris": "FRA", "nice": "FRA", "lyon": "FRA", "marseille": "FRA", "lille": "FRA",
    "barcelona": "ESP", "madrid": "ESP", "valencia": "ESP", "málaga": "ESP", "malaga": "ESP",
    "milan": "ITA", "rome": "ITA", "rimini": "ITA",
    "amsterdam": "NLD", "rotterdam": "NLD",
    "brussels": "BEL",
    "vienna": "AUT",
    "zurich": "CHE",
    "new york": "USA", "chicago": "USA", "dallas": "USA", "los angeles": "USA",
    "miami": "USA", "houston": "USA", "atlanta": "USA", "denver": "USA",
    "san jose": "USA", "anaheim": "USA", "charlotte": "USA", "jacksonville": "USA",
    "nashville": "USA", "austin": "USA", "phoenix": "USA", "portland": "USA",
    "washington": "USA", "boston": "USA", "minneapolis": "USA", "tampa": "USA",
    "toronto": "CAN",
    "sydney": "AUS", "melbourne": "AUS", "brisbane": "AUS",
    "singapore": "SGP",
    "hong kong": "HKG",
    "tokyo": "JPN",
    "seoul": "KOR", "busan": "KOR",
    "dubai": "ARE", "abu dhabi": "ARE",
    "riyadh": "SAU",
    "cape town": "ZAF", "johannesburg": "ZAF",
    "lisbon": "PRT",
    "dublin": "IRL",
    "athens": "GRC",
    "prague": "CZE",
    "budapest": "HUN",
    "stockholm": "SWE", "gothenburg": "SWE",
    "oslo": "NOR",
    "copenhagen": "DNK",
    "helsinki": "FIN",
    "warsaw": "POL", "gdansk": "POL",
    "mexico city": "MEX",
    "kuala lumpur": "MYS",
    "bangkok": "THA",
    "taipei": "TWN",
    "shanghai": "CHN", "beijing": "CHN", "shenzhen": "CHN", "guangzhou": "CHN",
    "dalian": "CHN", "chengdu": "CHN",
}


def city_to_country(city_name: str) -> str:
    """Best-effort city → ISO-2 country code."""
    normalized = city_name.strip().lower()
    # Try direct match
    if normalized in CITY_COUNTRY:
        return CITY_COUNTRY[normalized]
    # Try partial match
    for key, code in CITY_COUNTRY.items():
        if key in normalized or normalized in key:
            return code
    return "UNK"
