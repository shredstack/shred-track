-- The gym-level kill switch defaults ON now that each user opts in per
-- kind via notification preferences (default off — see DEFAULT_OFF_KINDS
-- in src/lib/notifications/preferences.ts). The gym flag remains as an
-- override so a gym admin who wants total silence can flip it off in
-- one place, but the user-pref check is the real default-off gate.

UPDATE feature_flags
SET default_value = 'true'::jsonb
WHERE key = 'gym_notifications';
