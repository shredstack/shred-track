-- Dependents — spec §3.5, §6 (PR 2).
--
-- Extend document_signatures to record sign-on-behalf for minors. A
-- guardian who signs for a minor sets `user_id = guardian`,
-- `subject_user_id = minor`, `signed_on_behalf_reason = 'parent_of_minor'`.
-- For self-signatures, subject_user_id is null (semantically equal to
-- user_id) and reason is null.
--
-- The existing `(document_version_id, user_id)` unique constraint
-- becomes `(document_version_id, coalesce(subject_user_id, user_id))`
-- so a guardian can sign the same waiver once per minor.

alter table document_signatures
  add column subject_user_id          uuid references users(id) on delete cascade,
  add column signed_on_behalf_reason  text
    check (signed_on_behalf_reason is null
           or signed_on_behalf_reason in ('parent_of_minor','legal_guardian')),
  add column signed_on_behalf_meta    jsonb;

-- Replace the unique constraint so it covers the (version, signed-for) tuple.
-- COALESCE picks the subject when set, else falls back to the signer.
-- The original unique came from an inline `unique (...)` clause in
-- 20260518110100_create_documents.sql, which Postgres auto-named
-- `document_signatures_document_version_id_user_id_key`.
alter table document_signatures
  drop constraint if exists document_signatures_document_version_id_user_id_key;

-- Some earlier migrations may have referred to the Drizzle-declared
-- name `document_signatures_version_user_unique`; drop that too if
-- it exists as either a constraint or a plain index.
alter table document_signatures
  drop constraint if exists document_signatures_version_user_unique;
drop index if exists document_signatures_version_user_unique;

create unique index if not exists document_signatures_version_subject_unique
  on document_signatures (
    document_version_id,
    coalesce(subject_user_id, user_id)
  );

create index document_signatures_subject_user_id_idx
  on document_signatures(subject_user_id)
  where subject_user_id is not null;
