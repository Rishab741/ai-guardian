-- People who use the executive console (not the employees whose AI traffic
-- flows through the gateway; those are end_users).
create table console_users (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      text not null references tenants(id) on delete cascade,
  email          text not null unique,
  display_name   text not null,
  title          text not null default '',
  role           text not null check (role in ('platform_admin', 'executive', 'ciso', 'compliance', 'tenant_admin', 'developer')),
  persona        boolean not null default false,  -- demo persona, usable via the simulated SSO screen
  created_at     timestamptz not null default now(),
  last_login_at  timestamptz
);
