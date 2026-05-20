-- Dependents — spec §3.3.
--
-- A "shadow" user is an account-holder–controlled profile with no real
-- auth user behind it. It holds scores logged on behalf of the
-- dependent, but cannot sign in. On activation (spec §3.3 step 3) a
-- Supabase auth user is created and is_shadow flips to false.
--
-- Storing is_shadow on the users row (instead of only on family_members)
-- keeps the social/leaderboard filter cheap — every query that
-- enumerates users for social context can simply add
-- `where users.is_shadow = false` without joining family_members.

alter table users
  add column is_shadow                 boolean not null default false,
  add column shadow_created_by_user_id uuid references users(id) on delete set null,
  add column shadow_created_at         timestamptz;

-- Partial index — almost every real query wants `where is_shadow = false`,
-- so we index only the rare "find shadow users" admin path.
create index users_shadow_idx on users(is_shadow) where is_shadow = true;
