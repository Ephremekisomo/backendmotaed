-- MOTAED / Supabase PostgreSQL schema
-- Execute this file in Supabase SQL Editor.
-- Admin passwords must be created with Supabase Auth, never inserted here.

create extension if not exists pgcrypto;

create type public.user_role as enum ('super_admin', 'admin');
create type public.user_status as enum ('actif', 'inactif');
create type public.rider_status as enum ('actif', 'suspendu', 'expire', 'desactive');
create type public.driver_type as enum ('motard', 'chauffeur_taxi', 'chauffeur_taxi_bus', 'autre');

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  username text unique,
  email text not null unique,
  phone text,
  password_hash text,
  role public.user_role not null default 'admin',
  status public.user_status not null default 'actif',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.riders (
  id uuid primary key default gen_random_uuid(),
  unique_code text not null unique default upper(encode(gen_random_bytes(8), 'hex')),
  photo_url text,
  first_name text not null,
  last_name text not null,
  middle_name text,
  gender text check (gender is null or gender in ('homme', 'femme', 'autre')),
  date_of_birth date,
  place_of_birth text,
  nationality text default 'Congolaise',
  address text,
  phone text,
  id_card_number text,
  driving_license_number text,
  license_category text,
  license_expiry_date date,
  driver_type public.driver_type not null default 'motard',
  identification_number text not null unique,
  plate_number text unique,
  vehicle_brand text,
  vehicle_model text,
  vehicle_color text,
  vehicle_year smallint check (vehicle_year is null or vehicle_year between 1900 and extract(year from now())::smallint + 1),
  chassis_number text,
  activity_zone text,
  status public.rider_status not null default 'actif',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users(id) on delete set null
);

create table public.qr_codes (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.riders(id) on delete cascade,
  unique_code text not null unique references public.riders(unique_code) on delete cascade,
  qr_url text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table public.verification_logs (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.riders(id) on delete cascade,
  verified_at timestamptz not null default now()
);

create index riders_unique_code_idx on public.riders(unique_code);
create index riders_identification_number_idx on public.riders(identification_number);
create index riders_plate_number_idx on public.riders(plate_number);
create index riders_phone_idx on public.riders(phone);
create index riders_status_idx on public.riders(status);
create index riders_driver_type_idx on public.riders(driver_type);
create index qr_codes_unique_code_idx on public.qr_codes(unique_code);
create index verification_logs_rider_id_idx on public.verification_logs(rider_id);
create index verification_logs_verified_at_idx on public.verification_logs(verified_at);

create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker set search_path = public
as $$ begin new.updated_at = now(); return new; end $$;

create trigger users_set_updated_at before update on public.users
for each row execute function public.set_updated_at();
create trigger riders_set_updated_at before update on public.riders
for each row execute function public.set_updated_at();

create or replace function public.create_rider_qr()
returns trigger language plpgsql security invoker set search_path = public
as $$
begin
  insert into public.qr_codes (rider_id, unique_code, qr_url)
  values (new.id, new.unique_code, 'https://monapplication.com/verify/' || new.unique_code);
  return new;
end;
$$;

create trigger riders_create_qr after insert on public.riders
for each row execute function public.create_rider_qr();

-- Public verification returns professional information only.
create or replace function public.verify_rider(code text)
returns table (
  first_name text, last_name text, middle_name text, photo_url text,
  driver_type public.driver_type, identification_number text, plate_number text,
  vehicle_brand text, vehicle_model text, activity_zone text, status public.rider_status,
  updated_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  insert into public.verification_logs (rider_id)
  select r.id
  from public.riders r
  join public.qr_codes q on q.rider_id = r.id
  where q.unique_code = upper(trim(code)) and q.revoked_at is null
  returning r.first_name, r.last_name, r.middle_name, r.photo_url,
    r.driver_type, r.identification_number, r.plate_number,
    r.vehicle_brand, r.vehicle_model, r.activity_zone, r.status, r.updated_at;
$$;
revoke all on function public.verify_rider(text) from public;
grant execute on function public.verify_rider(text) to anon, authenticated;

-- Row Level Security: public users can only use the restricted verification RPC.
alter table public.users enable row level security;
alter table public.riders enable row level security;
alter table public.qr_codes enable row level security;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.users where id = auth.uid() and status = 'actif'); $$;

create policy users_admin_access on public.users for all to authenticated
using (public.is_admin()) with check (public.is_admin());
create policy riders_admin_access on public.riders for all to authenticated
using (public.is_admin()) with check (public.is_admin());
create policy qr_codes_admin_access on public.qr_codes for all to authenticated
using (public.is_admin()) with check (public.is_admin());
create policy verification_logs_admin_access on public.verification_logs for all to authenticated
using (public.is_admin()) with check (public.is_admin());

-- Demo data. These records are for the application demo only.
insert into public.riders (
  first_name, last_name, nationality, phone, driver_type, identification_number,
  plate_number, vehicle_brand, vehicle_model, vehicle_color, activity_zone, status
) values
  ('Blaise', 'Kanku', 'Congolaise', '+243 810 000 001', 'motard', 'MOT-2024-0847', 'KN-5421-AB', 'Honda', 'CG 125', 'Noir', 'Ngaliema', 'actif'),
  ('Jean-Pierre', 'Mbuyi', 'Congolaise', '+243 810 000 002', 'chauffeur_taxi', 'TAX-2024-0846', 'CD-8842-KL', 'Toyota', 'Corolla', 'Bleu', 'Gombe', 'actif'),
  ('Grace', 'Lukusa', 'Congolaise', '+243 810 000 003', 'motard', 'MOT-2024-0845', 'KN-2201-CB', 'TVS', 'HLX 125', 'Rouge', 'Limete', 'suspendu'),
  ('Patrick', 'Ilunga', 'Congolaise', '+243 810 000 004', 'chauffeur_taxi_bus', 'BUS-2024-0844', 'CD-1130-AA', 'Mercedes', 'Sprinter', 'Blanc', 'Kintambo', 'expire')
on conflict (identification_number) do nothing;

-- After creating an admin in Authentication > Users, create its profile:
-- insert into public.users (id, full_name, email, role)
-- values ('AUTH_USER_UUID', 'Amadou Mukendi', 'admin@motaed.cd', 'super_admin');
