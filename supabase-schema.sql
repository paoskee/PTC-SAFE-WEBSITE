-- Run in the Supabase SQL editor before deploying the frontend.
-- Each table stores a document-compatible JSONB payload in its data column.
create table if not exists public.users (
  id text primary key,
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.alerts (
  id text primary key default gen_random_uuid()::text,
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.emergency_requests (
  id text primary key default gen_random_uuid()::text,
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.broadcasts (
  id text primary key default gen_random_uuid()::text,
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.incidents (
  id text primary key default gen_random_uuid()::text,
  data jsonb not null default '{}'::jsonb
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users
    where id = (select auth.uid())::text
      and data ->> 'isAdmin' = 'true'
  );
$$;

grant usage on schema public to authenticated;
grant select, insert, update, delete
  on public.users, public.alerts, public.emergency_requests,
     public.broadcasts, public.incidents
  to authenticated;
grant execute on function public.is_admin() to authenticated;

alter table public.users enable row level security;
alter table public.alerts enable row level security;
alter table public.emergency_requests enable row level security;
alter table public.broadcasts enable row level security;
alter table public.incidents enable row level security;

drop policy if exists "Users can read their profile or admins can read all" on public.users;
create policy "Users can read their profile or admins can read all"
  on public.users for select to authenticated
  using (id = (select auth.uid())::text or (select public.is_admin()));

drop policy if exists "Users can create a non-admin profile" on public.users;
create policy "Users can create a non-admin profile"
  on public.users for insert to authenticated
  with check (
    id = (select auth.uid())::text
    and data ->> 'isAdmin' is distinct from 'true'
  );

drop policy if exists "Users can update their non-admin profile" on public.users;
create policy "Users can update their non-admin profile"
  on public.users for update to authenticated
  using (id = (select auth.uid())::text and not (select public.is_admin()))
  with check (
    id = (select auth.uid())::text
    and data ->> 'isAdmin' is distinct from 'true'
  );

drop policy if exists "Admins can manage user profiles" on public.users;
create policy "Admins can manage user profiles"
  on public.users for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Admins can manage alerts" on public.alerts;
create policy "Admins can manage alerts"
  on public.alerts for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Users can read their alerts" on public.alerts;
create policy "Users can read their alerts"
  on public.alerts for select to authenticated
  using (data ->> 'userId' = (select auth.uid())::text);

drop policy if exists "Users can create their alerts" on public.alerts;
create policy "Users can create their alerts"
  on public.alerts for insert to authenticated
  with check (
    data ->> 'userId' = (select auth.uid())::text
    and lower(coalesce(data ->> 'status', 'pending')) = 'pending'
  );

drop policy if exists "Admins can manage emergency requests" on public.emergency_requests;
create policy "Admins can manage emergency requests"
  on public.emergency_requests for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Users can read their emergency requests" on public.emergency_requests;
create policy "Users can read their emergency requests"
  on public.emergency_requests for select to authenticated
  using (data ->> 'userId' = (select auth.uid())::text);

drop policy if exists "Users can create their emergency requests" on public.emergency_requests;
create policy "Users can create their emergency requests"
  on public.emergency_requests for insert to authenticated
  with check (
    data ->> 'userId' = (select auth.uid())::text
    and lower(coalesce(data ->> 'status', 'pending')) = 'pending'
  );

drop policy if exists "Authenticated users can read broadcasts" on public.broadcasts;
create policy "Authenticated users can read broadcasts"
  on public.broadcasts for select to authenticated
  using (true);

drop policy if exists "Admins can manage broadcasts" on public.broadcasts;
create policy "Admins can manage broadcasts"
  on public.broadcasts for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Admins can manage incidents" on public.incidents;
create policy "Admins can manage incidents"
  on public.incidents for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Users can read their incidents" on public.incidents;
create policy "Users can read their incidents"
  on public.incidents for select to authenticated
  using (data ->> 'userId' = (select auth.uid())::text);

drop policy if exists "Users can create their incidents" on public.incidents;
create policy "Users can create their incidents"
  on public.incidents for insert to authenticated
  with check (data ->> 'userId' = (select auth.uid())::text);

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'users',
    'alerts',
    'emergency_requests',
    'broadcasts',
    'incidents'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = target_table
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        target_table
      );
    end if;
  end loop;
end;
$$;
