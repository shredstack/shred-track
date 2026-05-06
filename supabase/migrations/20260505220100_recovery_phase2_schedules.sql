-- Recovery feature, Phase 2: schedules, slots, coach assignments, athlete overrides.
--
-- A schedule is the top-level prescription. Day-keyed schedules rotate
-- through a fixed number of "Day N" templates; frequency-keyed schedules
-- carry a single shared list with a weekly target.
--
-- Assignments tie a schedule to a target (single user OR a whole gym).
-- Athletes can shift their start/end without affecting the coach's
-- prescription via recovery_assignment_overrides.

CREATE TABLE recovery_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('day_keyed', 'frequency_keyed')),
  rotation_days int,
  weekly_target int,
  description text,
  rotation_strategy text NOT NULL DEFAULT 'progress'
    CHECK (rotation_strategy IN ('progress', 'calendar')),
  community_id uuid REFERENCES communities(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_recovery_schedules_community ON recovery_schedules(community_id);
CREATE INDEX idx_recovery_schedules_creator ON recovery_schedules(created_by);

CREATE TABLE recovery_schedule_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES recovery_schedules(id) ON DELETE CASCADE,
  day_index int,
  order_index int NOT NULL,
  movement_id uuid REFERENCES recovery_movements(id) ON DELETE RESTRICT,
  routine_id uuid REFERENCES recovery_routines(id) ON DELETE RESTRICT,
  prescription jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  CONSTRAINT chk_recovery_slot_target CHECK (
    (movement_id IS NOT NULL)::int + (routine_id IS NOT NULL)::int = 1
  )
);

CREATE INDEX idx_recovery_schedule_slots
  ON recovery_schedule_slots(schedule_id, day_index, order_index);

CREATE TABLE recovery_schedule_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES recovery_schedules(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  community_id uuid REFERENCES communities(id) ON DELETE CASCADE,
  starts_on date NOT NULL,
  ends_on date,
  duration_label text,
  assigned_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_recovery_assignment_target CHECK (
    (user_id IS NOT NULL)::int + (community_id IS NOT NULL)::int = 1
  )
);

CREATE INDEX idx_recovery_assignments_user
  ON recovery_schedule_assignments(user_id, starts_on);
CREATE INDEX idx_recovery_assignments_community
  ON recovery_schedule_assignments(community_id, starts_on);
CREATE INDEX idx_recovery_assignments_schedule
  ON recovery_schedule_assignments(schedule_id);

CREATE TABLE recovery_assignment_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES recovery_schedule_assignments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_on date,
  ends_on date,
  is_dismissed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, user_id)
);
