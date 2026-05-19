-- PR 3 §3.5 — Help & Support: "Ask the gym owner" needs a destination
-- address that doesn't depend on which admin happens to be on duty.
-- Falls back to gym admins' user emails when null.

alter table communities
  add column if not exists admin_email text;
