-- Dependents — spec §0 rule 1.
--
-- Per-gym feature flag. Defaults off; flip on for CFD (and any other
-- gym that wants family memberships) via /admin/feature-flags.

insert into feature_flags (key, description, default_value, is_per_gym)
values
  (
    'family_memberships',
    'Account holders can manage dependents under their account at a gym',
    'false'::jsonb,
    true
  )
on conflict (key) do nothing;
