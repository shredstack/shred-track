-- Block-level grouping under parts. A "block" is a labeled group of
-- movements within a single scored part — Drew has multiple blocks under
-- one For Time part. Blocks carry NO score; the part still owns scoring.
-- Movements are linked to a block (or null for ungrouped within a part),
-- which is how the rendering layer knows where to draw block headers.
--
-- Two parallel tables: benchmark_workout_blocks (library-level) and
-- workout_blocks (per-user copy). The benchmark→workout copy in the
-- POST /api/workouts route mirrors blocks so block headers persist into
-- the score-entry UI.
--
-- No backfill needed: a null block_id on movements means "no block" =
-- legacy flat rendering = current behavior for every existing row.

-- ============================================
-- benchmark_workout_blocks
-- ============================================

CREATE TABLE IF NOT EXISTS benchmark_workout_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  benchmark_workout_part_id UUID NOT NULL
    REFERENCES benchmark_workout_parts(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (benchmark_workout_part_id, order_index)
);

CREATE INDEX IF NOT EXISTS benchmark_workout_blocks_part_id_idx
  ON benchmark_workout_blocks (benchmark_workout_part_id);

ALTER TABLE benchmark_workout_movements
  ADD COLUMN IF NOT EXISTS benchmark_workout_block_id UUID
    REFERENCES benchmark_workout_blocks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS benchmark_workout_movements_block_id_idx
  ON benchmark_workout_movements (benchmark_workout_block_id);

ALTER TABLE benchmark_workout_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Benchmark blocks are readable with parent"
  ON benchmark_workout_blocks FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM benchmark_workout_parts bp
      JOIN benchmark_workouts bw ON bw.id = bp.benchmark_workout_id
      WHERE bp.id = benchmark_workout_blocks.benchmark_workout_part_id
    )
  );

CREATE POLICY "Benchmark blocks insertable by benchmark owner"
  ON benchmark_workout_blocks FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM benchmark_workout_parts bp
      JOIN benchmark_workouts bw ON bw.id = bp.benchmark_workout_id
      WHERE bp.id = benchmark_workout_blocks.benchmark_workout_part_id
        AND (bw.created_by = auth.uid() OR bw.is_system = true)
    )
  );

CREATE POLICY "Benchmark blocks updatable by benchmark owner"
  ON benchmark_workout_blocks FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM benchmark_workout_parts bp
      JOIN benchmark_workouts bw ON bw.id = bp.benchmark_workout_id
      WHERE bp.id = benchmark_workout_blocks.benchmark_workout_part_id
        AND bw.created_by = auth.uid()
    )
  );

CREATE POLICY "Benchmark blocks deletable by benchmark owner"
  ON benchmark_workout_blocks FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM benchmark_workout_parts bp
      JOIN benchmark_workouts bw ON bw.id = bp.benchmark_workout_id
      WHERE bp.id = benchmark_workout_blocks.benchmark_workout_part_id
        AND bw.created_by = auth.uid()
    )
  );

-- ============================================
-- workout_blocks (per-user copy)
-- ============================================

CREATE TABLE IF NOT EXISTS workout_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_part_id UUID NOT NULL
    REFERENCES workout_parts(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workout_part_id, order_index)
);

CREATE INDEX IF NOT EXISTS workout_blocks_part_id_idx
  ON workout_blocks (workout_part_id);

ALTER TABLE workout_movements
  ADD COLUMN IF NOT EXISTS workout_block_id UUID
    REFERENCES workout_blocks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS workout_movements_block_id_idx
  ON workout_movements (workout_block_id);

ALTER TABLE workout_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workout_blocks_select" ON workout_blocks FOR SELECT USING (
  workout_part_id IN (
    SELECT wp.id
    FROM workout_parts wp
    JOIN workouts w ON w.id = wp.workout_id
    WHERE w.created_by = auth.uid()
       OR w.community_id IN (
         SELECT community_id FROM community_memberships WHERE user_id = auth.uid()
       )
  )
);

CREATE POLICY "workout_blocks_insert" ON workout_blocks FOR INSERT WITH CHECK (
  workout_part_id IN (
    SELECT wp.id
    FROM workout_parts wp
    JOIN workouts w ON w.id = wp.workout_id
    WHERE w.created_by = auth.uid()
  )
);

CREATE POLICY "workout_blocks_update" ON workout_blocks FOR UPDATE USING (
  workout_part_id IN (
    SELECT wp.id
    FROM workout_parts wp
    JOIN workouts w ON w.id = wp.workout_id
    WHERE w.created_by = auth.uid()
  )
);

CREATE POLICY "workout_blocks_delete" ON workout_blocks FOR DELETE USING (
  workout_part_id IN (
    SELECT wp.id
    FROM workout_parts wp
    JOIN workouts w ON w.id = wp.workout_id
    WHERE w.created_by = auth.uid()
  )
);
