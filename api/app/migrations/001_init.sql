-- SovereignFabric core schema. Applied by app/db.py at startup; each file in
-- this directory runs once, in name order, inside a transaction.

create extension if not exists vector;
create extension if not exists pgcrypto;

create table tenants (
  id          text primary key,
  name        text not null,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create table departments (
  tenant_id  text not null references tenants(id) on delete cascade,
  id         text not null,
  label      text not null,
  primary key (tenant_id, id)
);

-- Versioned policy documents. Exactly one 'active' version per tenant.
create table policies (
  tenant_id    text not null references tenants(id) on delete cascade,
  version      integer not null,
  doc          jsonb not null,
  status       text not null check (status in ('draft', 'active', 'superseded')),
  created_by   text not null,
  created_at   timestamptz not null default now(),
  approved_by  text,
  approved_at  timestamptz,
  primary key (tenant_id, version)
);
create unique index policies_one_active on policies (tenant_id) where status = 'active';

-- Applications that call the gateway (the bank's chatbots, wikis, tools).
create table apps (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           text not null references tenants(id) on delete cascade,
  name                text not null,
  description         text not null default '',
  default_department  text not null,
  disabled            boolean not null default false,
  created_at          timestamptz not null default now(),
  unique (tenant_id, name)
);

-- Virtual API keys. Only a SHA-256 hash is stored; the prefix identifies a
-- key in the console without revealing it.
create table app_keys (
  id            uuid primary key default gen_random_uuid(),
  app_id        uuid not null references apps(id) on delete cascade,
  prefix        text not null,
  key_hash      text not null unique,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

-- People whose requests flow through apps. `id` is a stable pseudonymous
-- handle; display fields are shown to executives only when the tenant's
-- privacy mode allows it.
create table end_users (
  tenant_id     text not null references tenants(id) on delete cascade,
  id            text not null,
  external_ref  text,
  display_name  text not null,
  title         text not null default '',
  department    text not null,
  synthetic     boolean not null default false,
  created_at    timestamptz not null default now(),
  primary key (tenant_id, id)
);

-- Append-only, hash-chained audit trail. Never holds raw PII.
create table audit_events (
  id                   bigint generated always as identity primary key,
  tenant_id            text not null references tenants(id),
  ts                   timestamptz not null default now(),
  request_id           uuid not null,
  source               text not null check (source in ('gateway', 'console', 'simulator', 'seed')),
  endpoint             text not null,
  app_id               uuid,
  app_name             text,
  end_user_id          text,
  user_verified        boolean not null default false,
  department           text not null,
  department_label     text not null,
  decision             text not null check (decision in ('allowed', 'blocked', 'error')),
  policy_version       integer,
  policy_reason        text,
  flags                text[] not null default '{}',
  prompt_redacted      text not null,
  response_redacted    text,
  pii_types            text[] not null default '{}',
  pii_count            integer not null default 0,
  output_pii_masked    integer not null default 0,
  cache_hit            boolean not null default false,
  cache_similarity     double precision,
  model_requested      text,
  model_used           text,
  provider             text,
  tier                 text,
  fallbacks            text[] not null default '{}',
  stream               boolean not null default false,
  input_tokens         integer not null default 0,
  output_tokens        integer not null default 0,
  cost_usd             double precision not null default 0,
  cost_if_no_cache     double precision not null default 0,
  latency_ms           integer not null default 0,
  gateway_overhead_ms  integer not null default 0,
  rehydrated           integer not null default 0,
  rehydration_misses   integer not null default 0,
  prev_hash            text not null,
  hash                 text not null
);
create index audit_events_tenant_ts on audit_events (tenant_id, ts desc);
create index audit_events_tenant_dept_ts on audit_events (tenant_id, department, ts desc);
create index audit_events_tenant_user_ts on audit_events (tenant_id, end_user_id, ts desc);

-- Serialises hash-chain appends per tenant.
create table audit_chain_heads (
  tenant_id  text primary key references tenants(id),
  last_id    bigint not null,
  last_hash  text not null
);

-- Semantic cache. Lookups are exact nearest-neighbour searches *within* one
-- partition (tenant + entitlement scope + tier) and one token signature, so a
-- btree on those columns narrows the scan before any vector maths; at demo
-- scale that beats an approximate index and has no recall loss.
create table cache_entries (
  id                 bigint generated always as identity primary key,
  tenant_id          text not null references tenants(id) on delete cascade,
  partition_key      text not null,
  token_signature    text not null,
  embed_model        text not null,
  prompt_redacted    text not null,
  response_redacted  text not null,
  model_used         text not null,
  tier               text not null,
  embedding          vector(768) not null,
  hits               integer not null default 0,
  created_at         timestamptz not null default now(),
  expires_at         timestamptz not null
);
create index cache_entries_lookup on cache_entries (tenant_id, partition_key, token_signature, embed_model);

-- Daily request counts per model, shared by every gateway instance.
create table model_quota_usage (
  model     text not null,
  day       date not null,
  requests  integer not null default 0,
  primary key (model, day)
);
