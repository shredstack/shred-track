-- Dependents — spec §3.2.
--
-- Add an explicit "who pays for this seat" pointer to community_memberships.
-- For self-pay adults, account_id = user_id. For a dependent, account_id
-- points to the account holder's user_id and there is a matching
-- family_members row tying the same pair together inside the same gym.
--
-- The invariant (enforced in the app layer, not the DB):
--   For any community_memberships row, either
--     account_id = user_id (self-pay), or
--     there exists a family_members row in the same community with
--     dependent_user_id = community_memberships.user_id and
--     account_holder_user_id = community_memberships.account_id.

alter table community_memberships
  add column account_id uuid references users(id) on delete set null;

-- Backfill: every existing member is their own account holder.
update community_memberships
  set account_id = user_id
  where account_id is null;

-- After backfill, enforce non-null.
alter table community_memberships
  alter column account_id set not null;

create index community_memberships_account_idx
  on community_memberships(community_id, account_id);
