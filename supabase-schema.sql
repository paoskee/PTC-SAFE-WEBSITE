-- Run in the Supabase SQL editor before deploying the frontend.
-- Most tables use a document-compatible JSONB payload; alerts also expose
-- searchable and writable relational columns for the dashboard and RLS.
create table if not exists public.users (
  id text primary key,
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.alerts (
  id text primary key default gen_random_uuid()::text,
  user_id text,
  user_name text,
  user_phone text,
  responder_id text,
  latitude double precision,
  longitude double precision,
  emergency_type text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  responder_name text,
  responder_phone text,
  responder_unit text,
  responder_specialty text,
  responder_eta_minutes double precision,
  admin_note text,
  accepted_at timestamptz,
  dispatched_at timestamptz,
  resolved_at timestamptz,
  responder_latitude double precision,
  responder_longitude double precision,
  responder_location_updated_at timestamptz,
  data jsonb not null default '{}'::jsonb
);

alter table public.alerts
  add column if not exists user_id text,
  add column if not exists user_name text,
  add column if not exists user_phone text,
  add column if not exists responder_id text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists emergency_type text,
  add column if not exists status text,
  add column if not exists created_at timestamptz,
  add column if not exists responder_name text,
  add column if not exists responder_phone text,
  add column if not exists responder_unit text,
  add column if not exists responder_specialty text,
  add column if not exists responder_eta_minutes double precision,
  add column if not exists admin_note text,
  add column if not exists accepted_at timestamptz,
  add column if not exists dispatched_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists responder_latitude double precision,
  add column if not exists responder_longitude double precision,
  add column if not exists responder_location_updated_at timestamptz,
  add column if not exists data jsonb not null default '{}'::jsonb;

update public.alerts
set
  user_id = coalesce(user_id, nullif(data ->> 'user_id', ''), nullif(data ->> 'userId', '')),
  user_name = coalesce(
    user_name,
    nullif(data ->> 'user_name', ''),
    nullif(data ->> 'userName', '')
  ),
  user_phone = coalesce(
    user_phone,
    nullif(data ->> 'user_phone', ''),
    nullif(data ->> 'userPhone', '')
  ),
  responder_id = coalesce(
    responder_id,
    nullif(data ->> 'responder_id', ''),
    nullif(data ->> 'responderId', ''),
    nullif(data ->> 'assignedResponderId', '')
  ),
  latitude = coalesce(
    latitude,
    case
      when coalesce(data ->> 'latitude', data ->> 'lat') ~ '^-?[0-9]+([.][0-9]+)?$'
        then coalesce(data ->> 'latitude', data ->> 'lat')::double precision
    end
  ),
  longitude = coalesce(
    longitude,
    case
      when coalesce(data ->> 'longitude', data ->> 'lng') ~ '^-?[0-9]+([.][0-9]+)?$'
        then coalesce(data ->> 'longitude', data ->> 'lng')::double precision
    end
  ),
  emergency_type = coalesce(
    emergency_type,
    nullif(data ->> 'emergency_type', ''),
    nullif(data ->> 'emergencyType', ''),
    nullif(data ->> 'alert_type', '')
  ),
  status = lower(coalesce(nullif(status, ''), nullif(data ->> 'status', ''), 'pending')),
  responder_name = coalesce(
    responder_name,
    nullif(data ->> 'responder_name', ''),
    nullif(data ->> 'responderName', '')
  ),
  responder_phone = coalesce(
    responder_phone,
    nullif(data ->> 'responder_phone', ''),
    nullif(data ->> 'responderPhone', '')
  ),
  responder_unit = coalesce(
    responder_unit,
    nullif(data ->> 'responder_unit', ''),
    nullif(data ->> 'responderUnit', '')
  ),
  responder_specialty = coalesce(
    responder_specialty,
    nullif(data ->> 'responder_specialty', ''),
    nullif(data ->> 'responderSpecialty', '')
  ),
  responder_eta_minutes = coalesce(
    responder_eta_minutes,
    case
      when data ->> 'responderEtaMinutes' ~ '^-?[0-9]+([.][0-9]+)?$'
        then (data ->> 'responderEtaMinutes')::double precision
    end
  ),
  admin_note = coalesce(admin_note, nullif(data ->> 'adminNote', '')),
  accepted_at = coalesce(
    accepted_at,
    case
      when coalesce(data ->> 'accepted_at', data ->> 'acceptedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        then coalesce(data ->> 'accepted_at', data ->> 'acceptedAt')::timestamptz
    end
  ),
  dispatched_at = coalesce(
    dispatched_at,
    case
      when coalesce(data ->> 'dispatched_at', data ->> 'dispatchedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        then coalesce(data ->> 'dispatched_at', data ->> 'dispatchedAt')::timestamptz
    end
  ),
  resolved_at = coalesce(
    resolved_at,
    case
      when coalesce(data ->> 'resolved_at', data ->> 'resolvedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        then coalesce(data ->> 'resolved_at', data ->> 'resolvedAt')::timestamptz
    end
  ),
  responder_latitude = coalesce(
    responder_latitude,
    case
      when data ->> 'responderLatitude' ~ '^-?[0-9]+([.][0-9]+)?$'
        then (data ->> 'responderLatitude')::double precision
    end
  ),
  responder_longitude = coalesce(
    responder_longitude,
    case
      when data ->> 'responderLongitude' ~ '^-?[0-9]+([.][0-9]+)?$'
        then (data ->> 'responderLongitude')::double precision
    end
  ),
  created_at = coalesce(
    created_at,
    case
      when coalesce(data ->> 'created_at', data ->> 'createdAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        then coalesce(data ->> 'created_at', data ->> 'createdAt')::timestamptz
    end,
    now()
  );

alter table public.alerts
  alter column status set default 'pending',
  alter column status set not null,
  alter column created_at set default now(),
  alter column created_at set not null;

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
  using (user_id = (select auth.uid())::text);

drop policy if exists "Users can create their alerts" on public.alerts;
create policy "Users can create their alerts"
  on public.alerts for insert to authenticated
  with check (
    user_id = (select auth.uid())::text
    and lower(coalesce(status, 'pending')) = 'pending'
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
