-- PR 3 §3.2 — Document signing (waivers, membership agreements, etc.)
--
-- Versioned documents per gym. A new `document_versions` row on an
-- existing document invalidates all prior signatures for that document
-- (computed on read — no cascade needed). A `document_signatures` row
-- captures the legal substance: typed name, IP, timestamp, and the
-- version signed. The optional `pdf_url` is left null for v1 — the row
-- itself is the audit artifact (spec §3.2 D8).

create table documents (
  id                  uuid primary key default gen_random_uuid(),
  community_id        uuid references communities(id) on delete cascade,
  kind                text not null
    check (kind in ('waiver','membership_agreement','policy','custom')),
  title               text not null,
  is_required_on_join boolean not null default false,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  created_by          uuid references users(id)
);

create index documents_community_id_idx
  on documents(community_id)
  where is_active = true;

create table document_versions (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references documents(id) on delete cascade,
  version       int not null,
  body_markdown text not null,
  published_at  timestamptz not null default now(),
  published_by  uuid references users(id),
  unique (document_id, version)
);

create index document_versions_document_id_idx
  on document_versions(document_id, version desc);

create table document_signatures (
  id                  uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references document_versions(id) on delete cascade,
  user_id             uuid not null references users(id) on delete cascade,
  typed_name          text not null,
  signed_at           timestamptz not null default now(),
  signed_ip           inet,
  pdf_url             text,
  unique (document_version_id, user_id)
);

create index document_signatures_user_id_idx
  on document_signatures(user_id);
