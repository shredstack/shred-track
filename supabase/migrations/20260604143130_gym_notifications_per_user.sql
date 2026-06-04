-- Allow per-user overrides on `gym_notifications` so a dogfooder (or any
-- individual member) can opt themselves IN while the gym default stays
-- OFF. The resolver already honours user override → community override →
-- default; this flag just marks the key as user-overridable in the
-- registry. The notification fan-out sites filter the recipient list
-- against the flag per recipient (see filterRecipientsByFlag in
-- src/lib/feature-flags.ts).

UPDATE feature_flags
SET is_per_user = true
WHERE key = 'gym_notifications';
