-- ============================================
-- Movement Ownership
-- ============================================
--
-- Let users create their own custom movements that persist to the movements
-- table but are only visible to them. System movements (created_by = NULL)
-- remain globally visible.

ALTER TABLE movements
  ADD COLUMN created_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX movements_created_by_idx ON movements (created_by);

-- Swap the global UNIQUE(canonical_name) for two partial unique indexes:
-- system movements are globally unique by name, and a user's own movements
-- are unique within their namespace. This lets two users each have a
-- "Glute Bridge" without collision.

ALTER TABLE movements DROP CONSTRAINT movements_canonical_name_key;

CREATE UNIQUE INDEX movements_system_name_unique
  ON movements (canonical_name)
  WHERE created_by IS NULL;

CREATE UNIQUE INDEX movements_user_name_unique
  ON movements (created_by, canonical_name)
  WHERE created_by IS NOT NULL;

-- ============================================
-- RLS: users only see system movements + their own
-- ============================================

DROP POLICY IF EXISTS "movements_select_all" ON movements;

CREATE POLICY "movements_select_visible" ON movements FOR SELECT USING (
  created_by IS NULL OR created_by = auth.uid()
);

CREATE POLICY "movements_insert_own" ON movements FOR INSERT WITH CHECK (
  created_by = auth.uid()
);

CREATE POLICY "movements_update_own" ON movements FOR UPDATE USING (
  created_by = auth.uid()
);

CREATE POLICY "movements_delete_own" ON movements FOR DELETE USING (
  created_by = auth.uid()
);
