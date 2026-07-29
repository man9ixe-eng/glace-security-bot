-- Glace Hotels Staff Hub v2.6
-- Permanent LOA/timezone request and staff-profile storage.
-- Run this entire file once in Supabase: SQL Editor -> New query -> Run.

create table if not exists public.glace_staff_request_counters (
  year integer primary key,
  value bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.glace_staff_requests (
  id text primary key,
  guild_id text not null,
  request_number text not null unique,
  requester_id text not null,
  request_type text not null,
  status text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists glace_staff_requests_guild_updated_idx
  on public.glace_staff_requests (guild_id, updated_at desc);
create index if not exists glace_staff_requests_requester_idx
  on public.glace_staff_requests (guild_id, requester_id, updated_at desc);
create index if not exists glace_staff_requests_status_idx
  on public.glace_staff_requests (guild_id, status, updated_at desc);

create table if not exists public.glace_staff_request_audit (
  id text primary key,
  guild_id text,
  request_id text,
  request_number text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists glace_staff_request_audit_guild_created_idx
  on public.glace_staff_request_audit (guild_id, created_at desc);

create table if not exists public.glace_staff_profiles (
  guild_id text not null,
  user_id text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (guild_id, user_id)
);

create index if not exists glace_staff_profiles_guild_updated_idx
  on public.glace_staff_profiles (guild_id, updated_at desc);

create or replace function public.next_glace_staff_request_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_year integer := extract(year from now())::integer;
  next_value bigint;
begin
  insert into public.glace_staff_request_counters (year, value, updated_at)
  values (current_year, 1, now())
  on conflict (year)
  do update set
    value = public.glace_staff_request_counters.value + 1,
    updated_at = now()
  returning value into next_value;

  return 'GH-REQ-' || current_year::text || '-' || lpad(next_value::text, 4, '0');
end;
$$;

-- The Node/Render server uses the private Supabase secret/service-role key.
-- Browser users never connect directly to these tables.
alter table public.glace_staff_request_counters enable row level security;
alter table public.glace_staff_requests enable row level security;
alter table public.glace_staff_request_audit enable row level security;
alter table public.glace_staff_profiles enable row level security;

revoke all on public.glace_staff_request_counters from anon, authenticated;
revoke all on public.glace_staff_requests from anon, authenticated;
revoke all on public.glace_staff_request_audit from anon, authenticated;
revoke all on public.glace_staff_profiles from anon, authenticated;
revoke all on function public.next_glace_staff_request_number() from public, anon, authenticated;

grant execute on function public.next_glace_staff_request_number() to service_role;
grant select, insert, update, delete on public.glace_staff_request_counters to service_role;
grant select, insert, update, delete on public.glace_staff_requests to service_role;
grant select, insert, update, delete on public.glace_staff_request_audit to service_role;
grant select, insert, update, delete on public.glace_staff_profiles to service_role;
