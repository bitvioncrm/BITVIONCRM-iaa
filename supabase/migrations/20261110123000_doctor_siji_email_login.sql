-- Move Doctor Siji login from duty@drks.com to siji@drks.com.

do $$
declare
  siji_id uuid;
begin
  select id into siji_id from auth.users where lower(email) in ('duty@drks.com', 'siji@drks.com') order by case when lower(email) = 'siji@drks.com' then 0 else 1 end limit 1;
  if siji_id is null then
    raise exception 'Doctor Siji auth user missing';
  end if;

  if exists (select 1 from auth.users where lower(email) = 'siji@drks.com' and id <> siji_id) then
    raise exception 'siji@drks.com already exists on another user';
  end if;

  update auth.users
  set
    email = 'siji@drks.com',
    email_confirmed_at = coalesce(email_confirmed_at, now()),
    raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"full_name":"Doctor Siji"}'::jsonb,
    updated_at = now()
  where id = siji_id;

  update auth.identities
  set
    identity_data = coalesce(identity_data, '{}'::jsonb)
      || jsonb_build_object('email', 'siji@drks.com', 'email_verified', true, 'sub', siji_id::text),
    updated_at = now()
  where user_id = siji_id and provider = 'email';

  update public.profiles
  set
    email = 'siji@drks.com',
    full_name = 'Doctor Siji',
    updated_at = now()
  where id = siji_id;
end $$;
