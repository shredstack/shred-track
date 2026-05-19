-- PR 3 §3.1 — Extended profile fields.
--
-- Adds optional personal info (DOB, phone, address) plus emergency
-- contact triples to the users table. All nullable; the gym admin can
-- require them at sign-on-join via the documents flow (PR 3 §3.2),
-- but they're never blocking for solo (non-gym) users.
--
-- date_of_birth specifically unlocks the §3.8 birthday auto-posts —
-- the anniversary cron extends to fire on month_day matches once this
-- column is populated.

alter table users
  add column if not exists date_of_birth                date,
  add column if not exists phone                        text,
  add column if not exists address_line1                text,
  add column if not exists address_line2                text,
  add column if not exists city                         text,
  add column if not exists state                        text,
  add column if not exists postal_code                  text,
  add column if not exists country                      text,
  add column if not exists emergency_contact_name       text,
  add column if not exists emergency_contact_phone      text,
  add column if not exists emergency_contact_relation   text;
