#!/usr/bin/env python3
"""
Ad-hoc SQL runner against the ShredTrack database.

Reads DATABASE_URL from ../.env.local (default) or ../.env.prod (--env prod),
mirroring scrape_hyrox.py.

Usage:
    cd scripts
    uv run run_sql.py "SELECT division_key, COUNT(*) FROM hyrox_public_results GROUP BY 1"
    uv run run_sql.py --env prod "SELECT * FROM users LIMIT 5"
    uv run run_sql.py --file my_query.sql
    uv run run_sql.py --json "SELECT id, athlete_names_normalized FROM hyrox_public_results LIMIT 3"
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import click
import psycopg
from dotenv import dotenv_values
from psycopg.rows import dict_row


def _resolve_db_url(env_file: str, db_url: str | None) -> str | None:
    if db_url:
        return db_url
    repo_root = Path(__file__).parent.parent
    env_path = repo_root / (".env.local" if env_file == "local" else ".env.prod")
    if env_path.exists():
        url = dotenv_values(env_path).get("DATABASE_URL")
        if url:
            return url
    return os.environ.get("DATABASE_URL") or os.environ.get("SUPABASE_DB_URL")


def _format_value(v: object) -> str:
    """Render a single cell. Lists/dicts become compact JSON; None becomes ''."""
    if v is None:
        return ""
    if isinstance(v, (list, dict)):
        return json.dumps(v, default=str, ensure_ascii=False)
    return str(v)


def _print_table(rows: list[dict]) -> None:
    if not rows:
        click.echo("(no rows)")
        return
    columns = list(rows[0].keys())
    str_rows = [[_format_value(r[c]) for c in columns] for r in rows]
    widths = [
        max(len(c), *(len(row[i]) for row in str_rows))
        for i, c in enumerate(columns)
    ]
    sep = "  "
    click.echo(sep.join(c.ljust(widths[i]) for i, c in enumerate(columns)))
    click.echo(sep.join("-" * w for w in widths))
    for row in str_rows:
        click.echo(sep.join(cell.ljust(widths[i]) for i, cell in enumerate(row)))
    click.echo(f"\n({len(rows)} row{'s' if len(rows) != 1 else ''})")


def _is_read_only(sql: str) -> bool:
    """Best-effort check that the statement only reads. Used to gate prod writes."""
    stripped = sql.strip().lstrip("(").lstrip()
    head = stripped.split(None, 1)[0].lower() if stripped else ""
    return head in {"select", "with", "explain", "show", "values", "table"}


@click.command(context_settings={"help_option_names": ["-h", "--help"]})
@click.argument("query", required=False)
@click.option(
    "--file", "file_path",
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
    help="Read the SQL from a file instead of the QUERY argument.",
)
@click.option(
    "--env", "env_file",
    default="local",
    type=click.Choice(["local", "prod"]),
    show_default=True,
    help="Read DATABASE_URL from ../.env.local or ../.env.prod.",
)
@click.option("--db-url", default=None, help="Explicit Postgres connection string (overrides --env).")
@click.option("--json", "as_json", is_flag=True, help="Print rows as JSON (one object per line).")
@click.option("--yes", is_flag=True, help="Skip the confirmation prompt for non-SELECT against prod.")
def main(
    query: str | None,
    file_path: Path | None,
    env_file: str,
    db_url: str | None,
    as_json: bool,
    yes: bool,
) -> None:
    """Run an ad-hoc SQL query against local or prod."""
    if file_path and query:
        raise click.UsageError("Pass either QUERY or --file, not both.")
    if file_path:
        sql = file_path.read_text()
    elif query:
        sql = query
    elif not sys.stdin.isatty():
        sql = sys.stdin.read()
    else:
        raise click.UsageError("Provide a QUERY argument, --file, or pipe SQL on stdin.")

    sql = sql.strip()
    if not sql:
        raise click.UsageError("Empty query.")

    resolved_url = _resolve_db_url(env_file, db_url)
    if not resolved_url:
        click.echo(
            f"No DATABASE_URL found. Make sure ../.env.{env_file} exists or pass --db-url.",
            err=True,
        )
        sys.exit(1)

    # Guard rail: don't run mutating SQL against prod without confirmation.
    if env_file == "prod" and not _is_read_only(sql) and not yes:
        click.echo("⚠️  This looks like a write/DDL statement against PROD.", err=True)
        click.echo(f"    {sql.splitlines()[0][:120]}", err=True)
        if not click.confirm("Run it?", default=False):
            click.echo("Aborted.", err=True)
            sys.exit(1)

    with psycopg.connect(resolved_url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
            if cur.description is None:
                # Statement returned no rowset (e.g. UPDATE/INSERT/DDL).
                conn.commit()
                affected = cur.rowcount
                click.echo(f"OK ({affected} row{'s' if affected != 1 else ''} affected)")
                return
            rows = cur.fetchall()

    if as_json:
        for r in rows:
            click.echo(json.dumps(r, default=str, ensure_ascii=False))
    else:
        _print_table(rows)


if __name__ == "__main__":
    main()
