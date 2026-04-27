# ShredTrack Scripts

## HYROX Results Scraper

Manually-run Python script that scrapes public HYROX race results from `results.hyrox.com` and upserts them into the ShredTrack database.

### Setup

```bash
cd scripts
# Install dependencies with uv
uv sync
```

### Database Credentials

Both scripts automatically read `DATABASE_URL` from the project's env files:

- **Local (default):** Reads from `../.env.local` — no flags needed.
- **Production:** Reads from `../.env.prod` — pass `--env prod`.
- **Explicit override:** Pass `--db-url "postgresql://..."` to skip env files entirely.

**To set up for production:** Create a `.env.prod` file in the repo root with your production database credentials:

```
DATABASE_URL=postgresql://user:password@host:port/dbname
```

This file is gitignored and should never be committed.

### Usage

```bash
# Scrape into your local DB (reads DATABASE_URL from ../.env.local)
uv run scrape_hyrox.py --since 2024-04-01

# Dry run — parse and print, don't write to DB
uv run scrape_hyrox.py --since 2024-04-01 --dry-run

# Scrape into production DB
uv run scrape_hyrox.py --since 2024-04-01 --env prod

# Specific divisions only
uv run scrape_hyrox.py --since 2024-04-01 --divisions men_open,women_open

# Specific events only
uv run scrape_hyrox.py --since 2025-01-01 --events "London,Berlin"

# Interactive event selection — discover events, then pick from a list
uv run scrape_hyrox.py --since 2024-01-01 --pick

# Combine filters with interactive selection
uv run scrape_hyrox.py --since 2026-01-01 --events "Las Vegas" --pick

# Skip materialized view refresh
uv run scrape_hyrox.py --since 2024-04-01 --no-refresh-mv

# Replay only the dropped detail pages from a previous run's error file
uv run scrape_hyrox.py --retry-failed logs/scrape_errors_20260426_150500.json --env prod
```

### How It Works

1. Discovers events from the HYROX results site dropdown (seasons 6-8)
2. For each event, scrapes results list pages (100 per page) for each division
3. Fetches individual athlete detail pages to get full split breakdowns
4. Upserts into `hyrox_public_events`, `hyrox_public_results`, `hyrox_public_splits`
5. Refreshes the `hyrox_public_division_aggregates` materialized view

### Idempotency

- **Events:** `ON CONFLICT (external_id)` — re-running updates `scraped_at` only
- **Results:** `ON CONFLICT (event_id, external_result_id)` — replaces in place
- **Splits:** delete-then-insert per result in a single transaction

### Rate Limiting

- 0.8–1.5s delay between requests (with jitter)
- 6 retries on 5xx / connection errors with escalating backoff (~1s, 2s, 4s, 15s, 45s, 120s + jitter). 4xx responses are not retried.
- User-Agent identifies the script

### Parse Errors

Errors are logged to `scripts/logs/scrape_errors_<timestamp>.json` for review. `fetch_failed` entries include the metadata needed to replay them via `--retry-failed`, so dropped detail pages can be recovered without re-scraping the whole event.

## Model Training

```bash
# Train all divisions against local DB (reads from ../.env.local)
uv run train_models.py --all-divisions

# Train a single division
uv run train_models.py --division men_open

# Train against production
uv run train_models.py --all-divisions --env prod

# Dry run (trains models but doesn't save to DB)
uv run train_models.py --all-divisions --dry-run
```

See `train_models.py --help` for all options.
