-- MOTAED - Liaison d'un compte Supabase Auth au profil super administrateur
-- Executez ce script apres schema.sql.
-- Il cree un compte Auth de demonstration avec le mot de passe admin123.
-- Changez ce mot de passe apres votre premiere connexion.

do $$
declare
  auth_user auth.users%rowtype;
  account_id uuid;
begin
  select * into auth_user
  from auth.users
  where lower(email) = lower('admin@motaed.cd')
  limit 1;

  if auth_user.id is null then
    account_id := gen_random_uuid();
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values (
      account_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'admin@motaed.cd', crypt('admin123', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Amadou Mukendi"}'::jsonb, now(), now()
    );
    select * into auth_user from auth.users where id = account_id;
  end if;

  insert into public.users (id, full_name, username, email, role, status)
  values (
    auth_user.id,
    'Amadou Mukendi',
    'amadou.mukendi',
    auth_user.email,
    'super_admin',
    'actif'
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    username = excluded.username,
    email = excluded.email,
    role = 'super_admin',
    status = 'actif',
    updated_at = now();
end $$;

select id, full_name, username, email, role, status
from public.users
where lower(email) = lower('admin@motaed.cd');
