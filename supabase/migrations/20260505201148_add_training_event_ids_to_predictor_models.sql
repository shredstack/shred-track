-- Snapshot which races a predictor model was trained on, so the insights UI
-- can show users the exact dataset behind the feature importance card.
-- Nullable: existing rows stay null until their next retrain populates this.

ALTER TABLE hyrox_predictor_models
  ADD COLUMN training_event_ids jsonb;
