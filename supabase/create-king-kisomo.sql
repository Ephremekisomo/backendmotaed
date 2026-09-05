-- MOTAED - Création de l'utilisateur admin : king kisomo
-- Exécutez ce script dans Supabase > SQL Editor

do $$
declare
  auth_user auth.users%rowtype;
  account_id uuid;
  user_email text := 'king.kisomo@motaed.cd';
  user_password text := 'King@2024!';
begin
  select * into auth_user
  from auth.users
  where lower(email) = lower(user_email)
  limit 1;

  if auth_user.id is null then
    account_id := gen_random_uuid();
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values (
      account_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      user_email, crypt(user_password, gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"King Kisomo"}'::jsonb, now(), now()
    );
    select * into auth_user from auth.users where id = account_id;
  end if;

  insert into public.users (id, full_name, email, role, status)
  values (
    auth_user.id,
    'King Kisomo',
    user_email,
    'admin',
    'actif'
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    email = excluded.email,
    role = 'admin',
    status = 'actif',
    updated_at = now();
end $$;

select id, full_name, email, role, status
from public.users
where lower(email) = lower('king.kisomo@motaed.cd');
