-- PR 3 §3.7 — Hyrox tab gym-mode stub.
--
-- New per-gym feature flag. Gates whether the /hyrox tab renders the
-- gym's programmed Hyrox workouts above the existing AI plan flow.
-- Defaults off; flip on for CFD via /admin/feature-flags.

insert into feature_flags (key, description, default_value, is_per_gym)
values
  (
    'hyrox_programming',
    'Render gym-programmed Hyrox workouts on the /hyrox tab',
    'false'::jsonb,
    true
  )
on conflict (key) do nothing;
