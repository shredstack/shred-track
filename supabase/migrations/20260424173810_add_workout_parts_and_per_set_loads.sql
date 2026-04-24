-- ============================================
-- Multi-Part Workouts
-- ============================================
--
-- A workout can consist of multiple ordered parts, each with its own type,
-- configuration, and movements. Single-type workouts become 1-part workouts
-- via the backfill below.
--
-- `workouts.workout_type` / `time_cap_seconds` / `amrap_duration_seconds` /
-- `rep_scheme` remain for now as a grace period; once all code paths read
-- from parts we can drop them in a follow-up migration.

CREATE TABLE workout_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_id UUID NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL,
  label TEXT,
  workout_type TEXT NOT NULL,
  time_cap_seconds INTEGER,
  amrap_duration_seconds INTEGER,
  emom_interval_seconds INTEGER,
  rep_scheme TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workout_id, order_index)
);

CREATE INDEX workout_parts_workout_id_idx ON workout_parts (workout_id);

-- ============================================
-- Link workout_movements to a part
-- ============================================

ALTER TABLE workout_movements
  ADD COLUMN workout_part_id UUID REFERENCES workout_parts(id) ON DELETE CASCADE;

CREATE INDEX workout_movements_part_idx ON workout_movements (workout_part_id);

-- ============================================
-- Link scores to a part
-- ============================================

ALTER TABLE scores
  ADD COLUMN workout_part_id UUID REFERENCES workout_parts(id) ON DELETE CASCADE;

CREATE INDEX scores_part_idx ON scores (workout_part_id);

-- ============================================
-- Backfill: one part per existing workout
-- ============================================

DO $$
DECLARE
  workout_count INTEGER;
  part_count INTEGER;
BEGIN
  SELECT count(*) INTO workout_count FROM workouts;

  INSERT INTO workout_parts (
    workout_id, order_index, label, workout_type,
    time_cap_seconds, amrap_duration_seconds, rep_scheme
  )
  SELECT id, 0, NULL, workout_type,
         time_cap_seconds, amrap_duration_seconds, rep_scheme
  FROM workouts;

  SELECT count(*) INTO part_count FROM workout_parts;

  IF part_count <> workout_count THEN
    RAISE EXCEPTION 'workout_parts backfill mismatch: % workouts, % parts', workout_count, part_count;
  END IF;

  UPDATE workout_movements wm
  SET workout_part_id = wp.id
  FROM workout_parts wp
  WHERE wp.workout_id = wm.workout_id
    AND wp.order_index = 0
    AND wm.workout_part_id IS NULL;

  UPDATE scores s
  SET workout_part_id = wp.id
  FROM workout_parts wp
  WHERE wp.workout_id = s.workout_id
    AND wp.order_index = 0
    AND s.workout_part_id IS NULL;
END $$;

-- ============================================
-- Swap score uniqueness to part-scoped
-- ============================================
--
-- Existing (workout_id, user_id) uniqueness prevented logging more than one
-- score per workout. With parts, we need one score per (part, user) instead.

DROP INDEX IF EXISTS scores_workout_user;

CREATE UNIQUE INDEX scores_part_user_unique
  ON scores (workout_part_id, user_id)
  WHERE workout_part_id IS NOT NULL;

-- ============================================
-- RLS policies for workout_parts
-- ============================================

ALTER TABLE workout_parts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workout_parts_select" ON workout_parts FOR SELECT USING (
  workout_id IN (
    SELECT id FROM workouts
    WHERE created_by = auth.uid()
       OR community_id IN (
         SELECT community_id FROM community_memberships WHERE user_id = auth.uid()
       )
  )
);

CREATE POLICY "workout_parts_insert" ON workout_parts FOR INSERT WITH CHECK (
  workout_id IN (SELECT id FROM workouts WHERE created_by = auth.uid())
);

CREATE POLICY "workout_parts_update" ON workout_parts FOR UPDATE USING (
  workout_id IN (SELECT id FROM workouts WHERE created_by = auth.uid())
);

CREATE POLICY "workout_parts_delete" ON workout_parts FOR DELETE USING (
  workout_id IN (SELECT id FROM workouts WHERE created_by = auth.uid())
);
