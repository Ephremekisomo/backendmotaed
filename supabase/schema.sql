-- =========================================================
-- STEP 1 : drop everything that might conflict (safe re-run)
-- =========================================================
drop function if exists public.verify_identification(text);
drop function if exists public.verify_rider(text);
drop function if exists public.generate_identification_number();
drop function if exists public.create_rider_qr();
drop function if exists public.is_admin();
drop function if exists public.set_updated_at();

drop sequence if exists public.identification_seq;

drop table if exists public.identification_verification_logs cascade;
drop table if exists public.identification_records cascade;
drop table if exists public.drivers cascade;
drop table if exists public.vehicles cascade;
drop table if exists public.owners cascade;
drop table if exists public.verification_logs cascade;
drop table if exists public.qr_codes cascade;
drop table if exists public.riders cascade;
drop table if exists public.users cascade;

drop type if exists public.marital_status_kind;
drop type if exists public.gender_kind;
drop type if exists public.id_status;
drop type if exists public.vehicle_usage;
drop type if exists public.vehicle_kind;
drop type if exists public.driver_type;
drop type if exists public.rider_status;
drop type if exists public.user_status;
drop type if exists public.user_role;

-- =========================================================
-- STEP 2 : MOTAED schema
-- =========================================================
create extension if not exists pgcrypto;

create type public.user_role as enum ('super_admin', 'admin');
create type public.user_status as enum ('actif', 'inactif');
create type public.rider_status as enum ('actif', 'suspendu', 'expire', 'desactive');
create type public.driver_type as enum ('motard', 'chauffeur_taxi', 'chauffeur_taxi_bus', 'autre');
create type public.vehicle_kind as enum ('MOTO', 'TRICYCLE');
create type public.vehicle_usage as enum ('TAXI_TRANSPORT_PUBLIC', 'PERSONNEL', 'AUTRE');
create type public.id_status as enum ('ACTIF', 'SUSPENDU', 'EXPIRE', 'ARCHIVE');
create type public.gender_kind as enum ('M', 'F', 'AUTRE');
create type public.marital_status_kind as enum ('CELIBATAIRE', 'MARIE', 'DIVORCE', 'VEUF');

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

-- =========================================================
-- Identification sheets
-- =========================================================
create table public.owners (
  id uuid primary key default gen_random_uuid(),
  unique_identifier text not null unique default 'OWN-' || upper(encode(gen_random_bytes(6), 'hex')),
  first_name text not null,
  last_name text not null,
  middle_name text,
  date_of_birth date,
  place_of_birth text,
  gender public.gender_kind,
  phone text,
  guardian_name text,
  guardian_phone text,
  commune text,
  chefferie_sector text,
  neighborhood_group text,
  avenue_village text,
  photo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners(id) on delete cascade,
  registration_number text not null unique,
  vehicle_type public.vehicle_kind not null default 'MOTO',
  brand text,
  chassis_number text unique,
  engine_number text,
  color text,
  usage public.vehicle_usage not null default 'PERSONNEL',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.drivers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  middle_name text,
  date_of_birth date,
  place_of_birth text,
  gender public.gender_kind,
  phone text,
  father_name text,
  mother_name text,
  marital_status public.marital_status_kind default 'CELIBATAIRE',
  commune text,
  chefferie_sector text,
  neighborhood_group text,
  avenue_village text,
  origin text,
  photo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.identification_records (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null unique default gen_random_uuid(),
  identification_number text not null unique,
  owner_id uuid not null references public.owners(id) on delete restrict,
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  driver_id uuid not null references public.drivers(id) on delete restrict,
  qr_token text not null unique default encode(gen_random_bytes(18), 'hex'),
  qr_code_url text,
  issued_by uuid references public.users(id) on delete set null,
  issue_location text,
  issue_date date not null default current_date,
  status public.id_status not null default 'ACTIF',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.identification_verification_logs (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.identification_records(id) on delete cascade,
  verified_at timestamptz not null default now(),
  source text
);

create index owners_phone_idx on public.owners(phone);
create index owners_unique_identifier_idx on public.owners(unique_identifier);
create index vehicles_registration_number_idx on public.vehicles(registration_number);
create index vehicles_chassis_number_idx on public.vehicles(chassis_number);
create index drivers_phone_idx on public.drivers(phone);
create index identification_records_public_id_idx on public.identification_records(public_id);
create index identification_records_qr_token_idx on public.identification_records(qr_token);
create index identification_records_status_idx on public.identification_records(status);
create index identification_verification_logs_record_id_idx on public.identification_verification_logs(record_id);

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
create trigger owners_set_updated_at before update on public.owners
for each row execute function public.set_updated_at();
create trigger vehicles_set_updated_at before update on public.vehicles
for each row execute function public.set_updated_at();
create trigger drivers_set_updated_at before update on public.drivers
for each row execute function public.set_updated_at();
create trigger identification_records_set_updated_at before update on public.identification_records
for each row execute function public.set_updated_at();

create sequence public.identification_seq start 1 increment 1;

create or replace function public.generate_identification_number()
returns text language plpgsql security invoker set search_path = public
as $$
declare
  next_val bigint;
  formatted text;
begin
  select nextval('public.identification_seq') into next_val;
  formatted := lpad(next_val::text, 6, '0');
  return 'CCMT-NK/' || extract(year from now())::text || '/' || formatted;
end;
$$;

create or replace function public.verify_identification(token text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  record_row public.identification_records%rowtype;
  owner_row public.owners%rowtype;
  vehicle_row public.vehicles%rowtype;
  driver_row public.drivers%rowtype;
  issuer_name text;
  result jsonb;
begin
  select * into record_row from public.identification_records where qr_token = token limit 1;
  if not found then
    return jsonb_build_object('success', false, 'error', 'QR Code non reconnu');
  end if;
  select * into owner_row from public.owners where id = record_row.owner_id;
  select * into vehicle_row from public.vehicles where id = record_row.vehicle_id;
  select * into driver_row from public.drivers where id = record_row.driver_id;
  select full_name into issuer_name from public.users where id = record_row.issued_by;
  insert into public.identification_verification_logs (record_id, source) values (record_row.id, 'qr_scan');
  result := jsonb_build_object(
    'success', true,
    'identification', jsonb_build_object(
      'identification_number', record_row.identification_number,
      'public_id', record_row.public_id,
      'status', record_row.status,
      'issue_date', record_row.issue_date,
      'issue_location', record_row.issue_location,
      'issued_by', coalesce(issuer_name, ''),
      'owner', jsonb_build_object(
        'first_name', owner_row.first_name,
        'last_name', owner_row.last_name,
        'middle_name', owner_row.middle_name,
        'gender', owner_row.gender,
        'date_of_birth', owner_row.date_of_birth,
        'place_of_birth', owner_row.place_of_birth,
        'phone', owner_row.phone,
        'commune', owner_row.commune,
        'chefferie_sector', owner_row.chefferie_sector,
        'neighborhood_group', owner_row.neighborhood_group,
        'avenue_village', owner_row.avenue_village,
        'photo', owner_row.photo
      ),
      'vehicle', jsonb_build_object(
        'registration_number', vehicle_row.registration_number,
        'type', vehicle_row.vehicle_type,
        'brand', vehicle_row.brand,
        'chassis_number', vehicle_row.chassis_number,
        'engine_number', vehicle_row.engine_number,
        'color', vehicle_row.color,
        'usage', vehicle_row.usage
      ),
      'driver', jsonb_build_object(
        'first_name', driver_row.first_name,
        'last_name', driver_row.last_name,
        'middle_name', driver_row.middle_name,
        'gender', driver_row.gender,
        'date_of_birth', driver_row.date_of_birth,
        'place_of_birth', driver_row.place_of_birth,
        'phone', driver_row.phone,
        'father_name', driver_row.father_name,
        'mother_name', driver_row.mother_name,
        'marital_status', driver_row.marital_status,
        'origin', driver_row.origin,
        'commune', driver_row.commune,
        'chefferie_sector', driver_row.chefferie_sector,
        'neighborhood_group', driver_row.neighborhood_group,
        'avenue_village', driver_row.avenue_village,
        'photo', driver_row.photo
      ),
      'administrative', jsonb_build_object(
        'issue_date', record_row.issue_date,
        'issue_location', record_row.issue_location,
        'issued_by', coalesce(issuer_name, ''),
        'status', record_row.status
      )
    )
  );
  return result;
end;
$$;
revoke all on function public.verify_identification(text) from public;
grant execute on function public.verify_identification(text) to anon, authenticated;

create or replace function public.create_rider_qr()
returns trigger language plpgsql security invoker set search_path = public
as $$
begin
  insert into public.qr_codes (rider_id, unique_code, qr_url)
  values (new.id, new.unique_code, '/verify/' || new.unique_code);
  return new;
end;
$$;

create trigger riders_create_qr after insert on public.riders
for each row execute function public.create_rider_qr();

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

alter table public.users enable row level security;
alter table public.riders enable row level security;
alter table public.qr_codes enable row level security;
alter table public.verification_logs enable row level security;
alter table public.owners enable row level security;
alter table public.vehicles enable row level security;
alter table public.drivers enable row level security;
alter table public.identification_records enable row level security;
alter table public.identification_verification_logs enable row level security;

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
create policy owners_admin_access on public.owners for all to authenticated
using (public.is_admin()) with check (public.is_admin());
create policy vehicles_admin_access on public.vehicles for all to authenticated
using (public.is_admin()) with check (public.is_admin());
create policy drivers_admin_access on public.drivers for all to authenticated
using (public.is_admin()) with check (public.is_admin());
create policy identification_records_admin_access on public.identification_records for all to authenticated
using (public.is_admin()) with check (public.is_admin());
create policy identification_verification_logs_admin_access on public.identification_verification_logs for all to authenticated
using (public.is_admin()) with check (public.is_admin());

-- After creating an admin in Authentication > Users, create its profile:
-- insert into public.users (id, full_name, email, role)
-- values ('AUTH_USER_UUID', 'Amadou Mukendi', 'admin@motaed.cd', 'super_admin');
