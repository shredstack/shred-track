#!/usr/bin/env python3
"""
HYROX Model Training Script.

Trains LightGBM models on public race data for the Finish Time Predictor.
Run after a scrape to retrain models with fresh data.

Usage:
    cd scripts
    uv run train_models.py --division men_open
    uv run train_models.py --all-divisions
    uv run train_models.py --division men_open --dry-run
"""

from __future__ import annotations

import json
import logging
import os
import sys
import uuid
from datetime import datetime
from pathlib import Path

import click
from dotenv import dotenv_values
import lightgbm as lgb
import numpy as np
import pandas as pd
import psycopg
from psycopg.rows import dict_row
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, mean_absolute_error, r2_score
from sklearn.model_selection import cross_val_score, train_test_split

logger = logging.getLogger("train_models")


def setup_logging(env: str) -> Path:
    """Configure logging to both console and a timestamped file."""
    log_dir = Path(__file__).parent / "logs"
    log_dir.mkdir(exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_file = log_dir / f"train_{env}_{timestamp}.log"

    fmt = logging.Formatter(
        "%(asctime)s %(levelname)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    console = logging.StreamHandler()
    console.setFormatter(fmt)

    file_handler = logging.FileHandler(log_file)
    file_handler.setFormatter(fmt)

    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(console)
    root.addHandler(file_handler)

    logger.info(f"Logging to {log_file}")
    return log_file

STATION_ORDER = [
    "SkiErg", "Sled Push", "Sled Pull", "Burpee Broad Jumps",
    "Rowing", "Farmers Carry", "Sandbag Lunges", "Wall Balls",
]

RUN_LABELS = [f"Run {i}" for i in range(1, 9)]

# Feature columns: 8 station times + 8 run times + 5 ratios
FEATURE_NAMES = (
    [f"station_{s.lower().replace(' ', '_')}" for s in STATION_ORDER]
    + [f"run_{i}" for i in range(1, 9)]
    + ["ratio_sled_push_pull", "ratio_run1_run8", "ratio_burpees_wallballs",
       "ratio_ski_row", "ratio_farmers_lunges"]
)


def load_training_data(db_url: str, division: str) -> pd.DataFrame:
    """Load results + splits from the DB into a training DataFrame."""
    logger.info(f"Loading training data for {division}...")

    with psycopg.connect(db_url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            # Get all non-DNF results with their splits
            cur.execute(
                """
                SELECT
                    r.id AS result_id,
                    r.finish_time_seconds,
                    r.percentile,
                    s.segment_label,
                    s.segment_type,
                    s.time_seconds
                FROM hyrox_public_results r
                JOIN hyrox_public_splits s ON s.result_id = r.id
                WHERE r.division_key = %s
                AND r.is_dnf = false
                AND s.segment_type IN ('run', 'station')
                ORDER BY r.id, s.segment_order
                """,
                (division,),
            )
            rows = cur.fetchall()

    if not rows:
        logger.warning(f"No data found for {division}")
        return pd.DataFrame()

    # Pivot splits into feature columns
    records: dict[str, dict] = {}
    for row in rows:
        rid = row["result_id"]
        if rid not in records:
            records[rid] = {
                "finish_time_seconds": row["finish_time_seconds"],
                "percentile": float(row["percentile"]),
            }

        label = row["segment_label"]
        secs = row["time_seconds"]

        if row["segment_type"] == "station":
            col = f"station_{label.lower().replace(' ', '_')}"
            records[rid][col] = secs
        elif row["segment_type"] == "run":
            # "Run 1" -> "run_1"
            num = label.split()[-1]
            col = f"run_{num}"
            records[rid][col] = secs

    df = pd.DataFrame.from_dict(records, orient="index")

    # Filter to rows with all 16 segments
    required = [f"station_{s.lower().replace(' ', '_')}" for s in STATION_ORDER] + \
               [f"run_{i}" for i in range(1, 9)]
    df = df.dropna(subset=required)

    # Add derived ratios
    df["ratio_sled_push_pull"] = df["station_sled_push"] / df["station_sled_pull"].clip(lower=1)
    df["ratio_run1_run8"] = df["run_1"] / df["run_8"].clip(lower=1)
    df["ratio_burpees_wallballs"] = df["station_broad_jump_burpees"] / df["station_wall_balls"].clip(lower=1)
    df["ratio_ski_row"] = df["station_skierg"] / df["station_rowing"].clip(lower=1)
    df["ratio_farmers_lunges"] = df["station_farmers_carry"] / df["station_sandbag_lunges"].clip(lower=1)

    logger.info(f"Loaded {len(df)} complete results for {division}")
    return df


def train_finish_time_model(
    df: pd.DataFrame,
    objective: str = "regression",
    alpha: float | None = None,
) -> tuple[lgb.Booster, dict]:
    """Train a LightGBM model to predict finish time."""
    X = df[FEATURE_NAMES].values
    y = df["finish_time_seconds"].values

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42,
    )

    params: dict = {
        "objective": objective,
        "metric": "mae",
        "num_leaves": 63,
        "learning_rate": 0.05,
        "feature_fraction": 0.8,
        "bagging_fraction": 0.8,
        "bagging_freq": 5,
        "verbose": -1,
    }
    if alpha is not None:
        params["alpha"] = alpha

    train_data = lgb.Dataset(X_train, label=y_train, feature_name=FEATURE_NAMES)
    valid_data = lgb.Dataset(X_test, label=y_test, feature_name=FEATURE_NAMES)

    model = lgb.train(
        params,
        train_data,
        num_boost_round=500,
        valid_sets=[valid_data],
        callbacks=[lgb.early_stopping(50), lgb.log_evaluation(50)],
    )

    preds = model.predict(X_test)
    mae = mean_absolute_error(y_test, preds)
    r2 = r2_score(y_test, preds)

    metrics = {
        "mae": round(float(mae), 2),
        "r2": round(float(r2), 4),
        "training_n": len(X_train),
        "test_n": len(X_test),
    }

    logger.info(f"  {objective}{f' alpha={alpha}' if alpha else ''}: MAE={mae:.1f}s, R²={r2:.4f}")
    return model, metrics


def train_percentile_classifier(df: pd.DataFrame) -> tuple[RandomForestClassifier, dict, list]:
    """Train a Random Forest to predict percentile bucket (for feature importance)."""
    X = df[FEATURE_NAMES].values

    # Bucket percentile into 5 groups: 0-20, 20-40, 40-60, 60-80, 80-100
    y = pd.cut(df["percentile"], bins=[0, 20, 40, 60, 80, 100], labels=False).values

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42,
    )

    clf = RandomForestClassifier(
        n_estimators=200,
        max_depth=10,
        random_state=42,
        n_jobs=-1,
    )
    clf.fit(X_train, y_train)

    preds = clf.predict(X_test)
    accuracy = accuracy_score(y_test, preds)

    # Within ±1 bucket accuracy
    within_1 = np.mean(np.abs(preds - y_test) <= 1)

    # Cross-validation
    cv_scores = cross_val_score(clf, X, y, cv=3, scoring="accuracy")

    metrics = {
        "accuracy": round(float(accuracy), 4),
        "within_1_bucket": round(float(within_1), 4),
        "cv_mean": round(float(cv_scores.mean()), 4),
        "cv_std": round(float(cv_scores.std()), 4),
    }

    # Feature importances
    importances = [
        {"feature": name, "importance": round(float(imp), 4)}
        for name, imp in sorted(
            zip(FEATURE_NAMES, clf.feature_importances_),
            key=lambda x: -x[1],
        )
    ]

    logger.info(f"  RF classifier: accuracy={accuracy:.4f}, ±1 bucket={within_1:.4f}")
    logger.info(f"  Top 3 features: {', '.join(f['feature'] for f in importances[:3])}")

    return clf, metrics, importances


def save_model_to_db(
    db_url: str,
    division: str,
    model_type: str,
    model: lgb.Booster | None,
    metrics: dict,
    feature_importances: list | None = None,
    training_n: int = 0,
) -> str:
    """Save model artifact as JSON and record in hyrox_predictor_models."""
    model_id = str(uuid.uuid4())

    # Save model as JSON file
    output_dir = Path(__file__).parent / "models" / division
    output_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    artifact_path = output_dir / f"{model_type}_{timestamp}.json"

    if model is not None:
        model_json = model.dump_model()
        with open(artifact_path, "w") as f:
            json.dump(model_json, f)
        logger.info(f"  Model artifact saved to {artifact_path}")
    else:
        artifact_path = output_dir / f"{model_type}_{timestamp}_metadata.json"
        with open(artifact_path, "w") as f:
            json.dump({"metrics": metrics, "feature_importances": feature_importances}, f)

    # For now, use local path as artifact URL
    # In production, upload to Supabase Storage and use that URL
    artifact_url = str(artifact_path)

    with psycopg.connect(db_url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            # Deactivate previous active model of this type
            cur.execute(
                """
                UPDATE hyrox_predictor_models
                SET is_active = false, updated_at = NOW()
                WHERE division_key = %s AND model_type = %s AND is_active = true
                """,
                (division, model_type),
            )

            # Insert new model
            cur.execute(
                """
                INSERT INTO hyrox_predictor_models
                    (id, division_key, model_type, training_n, metrics,
                     feature_importances, artifact_url, is_active)
                VALUES
                    (%s, %s, %s, %s, %s, %s, %s, true)
                """,
                (
                    model_id, division, model_type, training_n,
                    json.dumps(metrics),
                    json.dumps(feature_importances or []),
                    artifact_url,
                ),
            )
            conn.commit()

    logger.info(f"  Model {model_type} saved to DB as {model_id}")
    return model_id


@click.command()
@click.option("--division", type=click.Choice(["men_open", "women_open", "men_pro", "women_pro"]),
              help="Single division to train")
@click.option("--all-divisions", is_flag=True, help="Train all four divisions")
@click.option("--dry-run", is_flag=True, help="Train but don't save to DB")
@click.option("--env", "env_file", default="local",
              type=click.Choice(["local", "prod"]),
              help="Environment to use: 'local' reads ../.env.local, 'prod' reads ../.env.prod")
@click.option("--db-url", default=None,
              help="Explicit Postgres connection string (overrides --env)")
def main(division: str | None, all_divisions: bool, dry_run: bool, env_file: str, db_url: str | None):
    """Train LightGBM + RF models for the HYROX Finish Time Predictor."""

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

    if not division and not all_divisions:
        logger.error("Must provide --division or --all-divisions")
        sys.exit(1)

    divisions = (
        ["men_open", "women_open", "men_pro", "women_pro"]
        if all_divisions
        else [division]
    )

    for div in divisions:
        logger.info(f"\n{'='*50}")
        logger.info(f"Training models for {div}")
        logger.info(f"{'='*50}")

        df = load_training_data(db_url, div)
        if len(df) < 100:
            logger.warning(f"Only {len(df)} results for {div} — skipping (need ≥100)")
            continue

        training_n = len(df)

        # 1. GBM finish time (median)
        logger.info("Training GBM finish time model (median)...")
        gbm_model, gbm_metrics = train_finish_time_model(df, objective="regression")

        # 2. GBM finish time (q10 — optimistic)
        logger.info("Training GBM finish time model (q10)...")
        q10_model, q10_metrics = train_finish_time_model(df, objective="quantile", alpha=0.1)

        # 3. GBM finish time (q90 — pessimistic)
        logger.info("Training GBM finish time model (q90)...")
        q90_model, q90_metrics = train_finish_time_model(df, objective="quantile", alpha=0.9)

        # 4. RF percentile classifier (for feature importance)
        logger.info("Training RF percentile classifier...")
        rf_clf, rf_metrics, importances = train_percentile_classifier(df)

        if dry_run:
            logger.info(f"[DRY RUN] Would save 4 models for {div}")
            logger.info(f"  GBM median:  {gbm_metrics}")
            logger.info(f"  GBM q10:     {q10_metrics}")
            logger.info(f"  GBM q90:     {q90_metrics}")
            logger.info(f"  RF:          {rf_metrics}")
            logger.info(f"  Top features: {[f['feature'] for f in importances[:5]]}")
        else:
            save_model_to_db(db_url, div, "gbm_finish_time", gbm_model, gbm_metrics,
                           training_n=training_n)
            save_model_to_db(db_url, div, "gbm_finish_time_q10", q10_model, q10_metrics,
                           training_n=training_n)
            save_model_to_db(db_url, div, "gbm_finish_time_q90", q90_model, q90_metrics,
                           training_n=training_n)
            save_model_to_db(db_url, div, "rf_percentile", None, rf_metrics,
                           feature_importances=importances, training_n=training_n)

    logger.info("\nDone!")


if __name__ == "__main__":
    main()
