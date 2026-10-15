-- Policy approval workflow: a proposed version waits for an approver who is
-- not its author (two-person rule) before it becomes active.
alter table policies drop constraint policies_status_check;
alter table policies add constraint policies_status_check
  check (status in ('draft', 'pending_approval', 'active', 'superseded', 'rejected'));
alter table policies add column note text not null default '';
alter table policies add column decision_note text;

-- Console actions (policy proposals and decisions, settings changes, app and
-- key management, report exports). Change-management evidence for CPS 234.
create table admin_events (
  id          bigint generated always as identity primary key,
  tenant_id   text not null references tenants(id) on delete cascade,
  ts          timestamptz not null default now(),
  actor       text not null,          -- console user email
  actor_role  text not null,
  action      text not null,          -- e.g. policy.proposed, policy.approved, app.created
  target      text not null default '',
  detail      jsonb not null default '{}'::jsonb
);
create index admin_events_tenant_ts on admin_events (tenant_id, ts desc);
