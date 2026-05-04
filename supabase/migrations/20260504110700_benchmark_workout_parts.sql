-- Multi-part benchmarks. Mirrors the workout_parts approach so a
-- benchmark like Drew (3 sections of work + a run between them) can be
-- modeled as discrete parts instead of crammed into a single movement
-- list. Existing benchmarks get backfilled with one part each so the
-- legacy single-part flow keeps working unchanged.

CREATE TABLE IF NOT EXISTS benchmark_workout_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  benchmark_workout_id UUID NOT NULL REFERENCES benchmark_workouts(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL,
  label TEXT,
  workout_type TEXT NOT NULL,
  time_cap_seconds INTEGER,
  amrap_duration_seconds INTEGER,
  emom_interval_seconds INTEGER,
  rep_scheme TEXT,
  rounds INTEGER,
  structure TEXT,
  interval_work_seconds INTEGER,
  interval_rest_seconds INTEGER,
  interval_rounds JSONB,
  side_cadence_interval_seconds INTEGER,
  side_cadence_open_ended BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (benchmark_workout_id, order_index)
);

CREATE INDEX IF NOT EXISTS benchmark_workout_parts_benchmark_id_idx
  ON benchmark_workout_parts (benchmark_workout_id);

ALTER TABLE benchmark_workout_movements
  ADD COLUMN IF NOT EXISTS benchmark_workout_part_id UUID
    REFERENCES benchmark_workout_parts(id) ON DELETE CASCADE;

-- Backfill: one part per existing benchmark, mirroring the legacy
-- single-shape columns. Movements get linked to that part.
INSERT INTO benchmark_workout_parts (
  benchmark_workout_id, order_index, label, workout_type,
  time_cap_seconds, amrap_duration_seconds, rep_scheme
)
SELECT bw.id, 0, NULL, bw.workout_type,
       bw.time_cap_seconds, bw.amrap_duration_seconds, bw.rep_scheme
FROM benchmark_workouts bw
LEFT JOIN benchmark_workout_parts bp
  ON bp.benchmark_workout_id = bw.id AND bp.order_index = 0
WHERE bp.id IS NULL;

UPDATE benchmark_workout_movements bm
SET benchmark_workout_part_id = bp.id
FROM benchmark_workout_parts bp
WHERE bp.benchmark_workout_id = bm.benchmark_workout_id
  AND bp.order_index = 0
  AND bm.benchmark_workout_part_id IS NULL;
