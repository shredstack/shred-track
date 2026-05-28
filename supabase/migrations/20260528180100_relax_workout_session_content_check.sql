-- Relax the workout_sessions content-shape CHECK constraint.
--
-- The original constraint required every non-freeform session (wod,
-- pre_skill, post_skill, at_home, monthly_challenge, custom) to point at a
-- crossfit_workouts template. That works for the spec's logical model but
-- it's incompatible with the existing gym-programming UX, where a coach
-- creates an empty "WOD" section and then fills the prescription via the
-- Smart Builder in a follow-up content PUT.
--
-- Relax it to allow EITHER a template OR a body for structured kinds;
-- freeform kinds keep requiring a body (warm-up / stretching never get a
-- template). The semantic guarantee — every session has *something* the
-- athlete can read — is preserved.

alter table workout_sessions
  drop constraint workout_sessions_content_check;

alter table workout_sessions
  add constraint workout_sessions_content_check check (
    (kind in ('warm_up', 'stretching') and crossfit_workout_id is null and body is not null)
    or (kind not in ('warm_up', 'stretching')
        and (crossfit_workout_id is not null or body is not null))
  );
