-- Class schedules + registration (spec §2.2).
--
-- Parallel model to recovery_schedules but built specifically for gym
-- classes (CrossFit, Hyrox, Olympic lifting, etc.). A schedule has slots
-- that recur on an RRULE; a nightly Inngest function materializes
-- class_instances 4 weeks ahead. Members register against the instance.

CREATE TABLE IF NOT EXISTS class_schedules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id     uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name             text NOT NULL,
  description      text,
  default_capacity int NOT NULL DEFAULT 20,
  default_coach_id uuid REFERENCES users(id),
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS class_schedules_community_idx
  ON class_schedules(community_id) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS class_schedule_slots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id  uuid NOT NULL REFERENCES class_schedules(id) ON DELETE CASCADE,
  -- e.g. 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
  rrule        text NOT NULL,
  start_time   time NOT NULL,
  duration_min int NOT NULL,
  capacity     int,
  coach_id     uuid REFERENCES users(id),
  active_from  date NOT NULL,
  active_to    date,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS class_schedule_slots_schedule_idx
  ON class_schedule_slots(schedule_id);

CREATE TABLE IF NOT EXISTS class_instances (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id         uuid REFERENCES class_schedules(id) ON DELETE SET NULL,
  slot_id             uuid REFERENCES class_schedule_slots(id) ON DELETE SET NULL,
  community_id        uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  start_at            timestamptz NOT NULL,
  end_at              timestamptz NOT NULL,
  coach_id            uuid REFERENCES users(id),
  capacity            int NOT NULL,
  status              text NOT NULL CHECK (status IN ('scheduled','cancelled','completed')) DEFAULT 'scheduled',
  cancellation_reason text,
  workout_id          uuid REFERENCES workouts(id),
  kind                text NOT NULL CHECK (kind IN ('class','event')) DEFAULT 'class',
  -- For kind='event' (Murph, Open WODs, etc.).
  event_title         text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS class_instances_community_start
  ON class_instances(community_id, start_at);

-- Deduplicate the materializer: at most one instance per (slot, start_at).
CREATE UNIQUE INDEX IF NOT EXISTS class_instances_slot_start_unique
  ON class_instances(slot_id, start_at) WHERE slot_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS class_registrations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_instance_id uuid NOT NULL REFERENCES class_instances(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status            text NOT NULL CHECK (status IN ('registered','cancelled','no_show','attended')),
  registered_at     timestamptz NOT NULL DEFAULT now(),
  cancelled_at      timestamptz,
  attended_at       timestamptz,
  UNIQUE (class_instance_id, user_id)
);

CREATE INDEX IF NOT EXISTS class_registrations_user_idx
  ON class_registrations(user_id, status);
