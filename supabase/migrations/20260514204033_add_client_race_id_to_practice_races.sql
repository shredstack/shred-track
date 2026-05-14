-- Watch/phone save idempotency for the HYROX race timer.
--
-- Background: either device (paired Apple Watch or iPhone) can tap
-- Finish on a race. With watch_finish_owns_save_spec.md, the watch
-- always builds a save payload locally and queues it for sync, so a
-- phone-origin race finished on the watch (with the phone out of
-- range) can no longer be lost. The trade-off: in race conditions
-- where both devices end up POSTing the same race, we need the
-- server to dedup instead of writing two rows.
--
-- We dedup on a client-supplied UUID that both devices share from the
-- moment a race begins (see RaceState.raceId on the watch / phone
-- timer hooks). The first POST inserts; subsequent POSTs for the same
-- (user_id, client_race_id) are an idempotent no-op.
--
-- The unique index is PARTIAL — pre-existing rows and any future
-- server-originated races have client_race_id NULL, and we don't want
-- NULL collisions blocking legitimate inserts.

ALTER TABLE hyrox_practice_races
  ADD COLUMN client_race_id text;

CREATE UNIQUE INDEX hyrox_practice_races_user_client_race_id_key
  ON hyrox_practice_races (user_id, client_race_id)
  WHERE client_race_id IS NOT NULL;
