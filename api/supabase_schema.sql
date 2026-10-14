-- SovereignFabric production schema — paste this into the Supabase SQL editor
-- (Project -> SQL Editor -> New query) on a fresh free-tier project, then Run.
--
-- Note on RLS: the FastAPI backend connects with Supabase's direct Postgres
-- connection string as the `postgres` role, which bypasses RLS (Supabase's
-- managed setup grants it BYPASSRLS). Authorization for backend requests is
-- therefore enforced in application code (see api/auth.py), not by RLS alone.
-- These policies exist as defense-in-depth for any future direct client
-- access via the Supabase client libraries / PostgREST.

create extension if not exists vector;

-- ── profiles ────────────────────────────────────────────────────────────
-- One row per Supabase Auth user. Department/role start unset; an admin
-- assigns them (there is no self-service department picker in production
-- mode — see api/auth.py and web/src/app/chat/page.tsx).
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  department text,
  role text not null default 'member' check (role in ('member', 'admin')),
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "profiles: read own" on profiles
  for select using (auth.uid() = id);

create policy "profiles: admins read all" on profiles
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Auto-create a profile row whenever a new user signs up via Supabase Auth.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── audit_logs ──────────────────────────────────────────────────────────
-- Postgres equivalent of the SQLite schema in api/database.py. Never stores
-- raw PII — only already-redacted text and detection metadata.
create table if not exists audit_logs (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  department text not null,
  department_label text not null,
  user_label text not null,
  prompt_redacted text not null,
  response_redacted text,
  cache_hit boolean not null default false,
  model_used text,
  model_label text,
  tier text,
  input_tokens integer default 0,
  output_tokens integer default 0,
  cost_usd double precision default 0,
  cost_if_no_cache double precision default 0,
  latency_ms integer default 0,
  policy_allowed boolean not null default true,
  policy_reason text,
  pii_types jsonb not null default '[]'::jsonb,
  pii_count integer not null default 0
);

create index if not exists idx_audit_logs_ts on audit_logs (ts);
create index if not exists idx_audit_logs_department on audit_logs (department);

alter table audit_logs enable row level security;

create policy "audit_logs: members see own department" on audit_logs
  for select using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and (p.role = 'admin' or p.department = audit_logs.department)
    )
  );

create policy "audit_logs: members insert own department" on audit_logs
  for insert with check (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and (p.role = 'admin' or p.department = audit_logs.department)
    )
  );

-- ── cache_entries ───────────────────────────────────────────────────────
-- Semantic cache: pgvector similarity search over real Gemini embeddings,
-- replacing the in-memory hashed-bag-of-words cache used in demo mode.
-- text-embedding-004 produces 768-dimensional vectors.
create table if not exists cache_entries (
  id bigint generated always as identity primary key,
  prompt_redacted text not null,
  response text not null,
  model_used text not null,
  embedding vector(768) not null,
  created_at timestamptz not null default now()
);

-- Approximate nearest-neighbor index for cosine distance (<=>). IVFFlat is
-- fine at this scale; lists=100 is a reasonable default under ~1M rows.
create index if not exists idx_cache_entries_embedding on cache_entries
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- No end-user RLS policies here: the cache is an internal implementation
-- detail of the backend, not user-facing data.
alter table cache_entries enable row level security;
