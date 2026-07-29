-- Glace Hotels Staff Hub v2.5
-- Permanent promotion-submission storage for the free Supabase tier.
-- Run this entire file once in Supabase: SQL Editor -> New query -> Run.

create table if not exists public.glace_promotion_counters (
  year integer primary key,
  value bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.glace_promotion_submissions (
  id text primary key,
  guild_id text not null,
  submission_number text not null unique,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists glace_promotion_submissions_guild_updated_idx
  on public.glace_promotion_submissions (guild_id, updated_at desc);

create table if not exists public.glace_promotion_audit (
  id text primary key,
  guild_id text,
  submission_id text,
  submission_number text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists glace_promotion_audit_guild_created_idx
  on public.glace_promotion_audit (guild_id, created_at desc);

create or replace function public.next_glace_promotion_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_year integer := extract(year from now())::integer;
  next_value bigint;
begin
  insert into public.glace_promotion_counters (year, value, updated_at)
  values (current_year, 1, now())
  on conflict (year)
  do update set
    value = public.glace_promotion_counters.value + 1,
    updated_at = now()
  returning value into next_value;

  return 'GH-PR-' || current_year::text || '-' || lpad(next_value::text, 4, '0');
end;
$$;

-- The website server uses the service-role key. Browser users never connect
-- directly to these tables. RLS remains enabled with no public policies.
alter table public.glace_promotion_counters enable row level security;
alter table public.glace_promotion_submissions enable row level security;
alter table public.glace_promotion_audit enable row level security;

revoke all on public.glace_promotion_counters from anon, authenticated;
revoke all on public.glace_promotion_submissions from anon, authenticated;
revoke all on public.glace_promotion_audit from anon, authenticated;
revoke all on function public.next_glace_promotion_number() from public, anon, authenticated;
grant execute on function public.next_glace_promotion_number() to service_role;

grant select, insert, update, delete on public.glace_promotion_submissions to service_role;
grant select, insert, update, delete on public.glace_promotion_audit to service_role;
grant select, insert, update, delete on public.glace_promotion_counters to service_role;
