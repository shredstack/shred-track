-- Dependents / Family Memberships — spec §3.1, §4.6.
--
-- A `family_members` row is the administrative tie between an account
-- holder and a dependent inside a single gym. Both sides already have
-- their own `users` row and `community_memberships` row — this table
-- only models the directed edge. v1 is one account holder per dependent
-- per gym; joint custody is out of scope.
--
-- `family_invites` covers the "I added an existing ShredTrack user as
-- my dependent" branch — the existing user must consent before we
-- create the link.

create table family_members (
  id                          uuid primary key default gen_random_uuid(),
  community_id                uuid not null references communities(id) on delete cascade,
  -- restrict on delete: dependents must be re-parented or cascade-deleted
  -- explicitly. Letting the DB null this out would orphan minors.
  account_holder_user_id      uuid not null references users(id) on delete restrict,
  dependent_user_id           uuid not null references users(id) on delete cascade,
  relationship                text not null check (relationship in (
    'spouse','partner','child','parent','sibling','other'
  )),
  -- Denormalized mirror of users.is_shadow = false. Kept in sync by
  -- the activation flow (spec §3.3) so the family list query doesn't
  -- need to join users.
  has_own_login               boolean not null default false,
  activation_token            text unique,
  activation_token_sent_at    timestamptz,
  activation_token_expires_at timestamptz,
  activated_at                timestamptz,
  notes                       text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  -- v1: one account holder per dependent per gym.
  unique (community_id, dependent_user_id),
  -- A given pair can only be linked once per gym (defensive — implied
  -- by the row above, but explicit for clarity in DDL).
  unique (community_id, account_holder_user_id, dependent_user_id),
  -- No self-parenting.
  check (account_holder_user_id <> dependent_user_id)
);

create index family_members_account_holder_idx
  on family_members(account_holder_user_id, community_id);
create index family_members_dependent_idx
  on family_members(dependent_user_id, community_id);

-- Pending invites for the "existing user as dependent" branch. The
-- recipient opens the email link and accepts or declines; only on
-- accept do we materialize a `family_members` row.
create table family_invites (
  id                     uuid primary key default gen_random_uuid(),
  community_id           uuid not null references communities(id) on delete cascade,
  account_holder_user_id uuid not null references users(id) on delete cascade,
  invitee_user_id        uuid not null references users(id) on delete cascade,
  relationship           text not null check (relationship in (
    'spouse','partner','child','parent','sibling','other'
  )),
  token                  text not null unique,
  expires_at             timestamptz not null,
  responded_at           timestamptz,
  response               text check (response in ('accepted','declined')),
  created_at             timestamptz not null default now()
);

create index family_invites_invitee_idx
  on family_invites(invitee_user_id);
create index family_invites_account_holder_idx
  on family_invites(account_holder_user_id, community_id);
