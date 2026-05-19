-- Add a freeform body field to workout_sections so coaches can write
-- prescriptions for warm-ups, stretching, and any other section kind
-- that doesn't need the full Smart Builder part/movement composition.
-- The Smart Builder still writes into workout_parts; body is the
-- lightweight escape hatch.

alter table workout_sections
  add column if not exists body text;
