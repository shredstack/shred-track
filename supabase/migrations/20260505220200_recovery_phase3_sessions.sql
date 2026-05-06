-- Recovery feature, Phase 3: sessions (logged days) + per-movement detail.
--
-- A `recovery_session` is one day's logged work for one user against one
-- schedule. `prescribed` is snapshotted at session start so a coach
-- editing the schedule mid-week doesn't rewrite history.

CREATE TABLE recovery_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  schedule_id uuid REFERENCES recovery_schedules(id) ON DELETE SET NULL,
  assignment_id uuid REFERENCES recovery_schedule_assignments(id) ON DELETE SET NULL,
  session_date date NOT NULL,
  day_index int,
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'complete', 'skipped')),
  notes text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (user_id, session_date, schedule_id)
);

CREATE INDEX idx_recovery_sessions_user_date
  ON recovery_sessions(user_id, session_date DESC);
CREATE INDEX idx_recovery_sessions_schedule
  ON recovery_sessions(schedule_id);

CREATE TABLE recovery_session_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES recovery_sessions(id) ON DELETE CASCADE,
  movement_id uuid NOT NULL REFERENCES recovery_movements(id) ON DELETE RESTRICT,
  routine_id uuid REFERENCES recovery_routines(id) ON DELETE SET NULL,
  schedule_slot_id uuid REFERENCES recovery_schedule_slots(id) ON DELETE SET NULL,
  order_index int NOT NULL,
  prescribed jsonb NOT NULL DEFAULT '{}'::jsonb,
  actual jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'done', 'skipped')),
  notes text
);

CREATE INDEX idx_recovery_session_items_session
  ON recovery_session_items(session_id, order_index);
