-- Three equal clinic doctors: Rimisha, Siji, Bhama.
-- Reception assigns patients by appointment.doctor_id; doctors only see assigned patients.

update public.roles set name = 'Doctor Rimisha' where key = 'doctor';
update public.roles set name = 'Doctor Siji' where key = 'duty_doctor';

insert into public.roles (key, name) values ('doctor_bhama', 'Doctor Bhama')
on conflict (key) do update set name = excluded.name;

update public.profiles
set full_name = 'Doctor Rimisha', updated_at = now()
where email = 'doctor@drks.com';

update public.profiles
set full_name = 'Doctor Siji', updated_at = now()
where email = 'duty@drks.com';

update auth.users
set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"full_name":"Doctor Rimisha"}'::jsonb
where lower(email) = 'doctor@drks.com';

update auth.users
set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"full_name":"Doctor Siji"}'::jsonb
where lower(email) = 'duty@drks.com';

do $$
declare
  new_id uuid := gen_random_uuid();
  clinic_ws uuid;
  org_id uuid;
  bhama_role uuid;
  existing uuid;
begin
  select id, organization_id into clinic_ws, org_id
  from public.workspaces
  where workspace_type = 'clinic' and deleted_at is null
  order by created_at
  limit 1;

  if clinic_ws is null then
    raise exception 'Clinic workspace missing';
  end if;

  select id into existing from auth.users where lower(email) = 'bhama@drks.com';
  if existing is null then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      is_sso_user, is_anonymous
    ) values (
      '00000000-0000-0000-0000-000000000000',
      new_id,
      'authenticated',
      'authenticated',
      'bhama@drks.com',
      crypt(gen_random_uuid()::text, gen_salt('bf')), -- set real password in Auth after migrate
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Doctor Bhama"}'::jsonb,
      now(),
      now(),
      '', '', '', '',
      false,
      false
    );

    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(),
      new_id,
      jsonb_build_object('sub', new_id::text, 'email', 'bhama@drks.com', 'email_verified', true),
      'email',
      new_id::text,
      now(),
      now(),
      now()
    );

    update public.profiles
    set full_name = 'Doctor Bhama',
        organization_id = org_id,
        email = 'bhama@drks.com',
        updated_at = now()
    where id = new_id;

    select id into bhama_role from public.roles where key = 'doctor_bhama';
    insert into public.user_roles (user_id, role_id, workspace_id, organization_id)
    values (new_id, bhama_role, clinic_ws, org_id);
  else
    update public.profiles
    set full_name = 'Doctor Bhama', organization_id = org_id, updated_at = now()
    where id = existing;

    select id into bhama_role from public.roles where key = 'doctor_bhama';
    insert into public.user_roles (user_id, role_id, workspace_id, organization_id)
    select existing, bhama_role, clinic_ws, org_id
    where not exists (
      select 1 from public.user_roles ur
      where ur.user_id = existing and ur.role_id = bhama_role and ur.workspace_id = clinic_ws
    );
  end if;
end $$;

create or replace function public.can_use_clinic(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or exists (select 1 from public.workspaces w where w.id = ws and public.is_org_admin(w.organization_id))
    or exists (
      select 1 from public.workspace_role_keys(ws) k
      where k in ('receptionist', 'doctor', 'duty_doctor', 'doctor_bhama', 'admin')
    );
$$;

create or replace function public.list_clinic_doctors(ws uuid)
returns table (user_id uuid, full_name text, role_key text)
language sql
stable
security definer
set search_path = public
as $$
  select
    ur.user_id,
    coalesce(
      nullif(trim(p.full_name), ''),
      case r.key
        when 'duty_doctor' then 'Doctor Siji'
        when 'doctor_bhama' then 'Doctor Bhama'
        else 'Doctor Rimisha'
      end
    ) as full_name,
    r.key as role_key
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  left join public.profiles p on p.id = ur.user_id
  where ur.workspace_id = ws
    and r.key in ('doctor', 'duty_doctor', 'doctor_bhama')
    and (
      public.is_super_admin()
      or public.can_use_clinic(ws)
      or ws in (select public.member_workspace_ids())
      or exists (
        select 1 from public.workspaces w
        where w.id = ws and public.is_org_admin(w.organization_id)
      )
    )
  order by
    case r.key when 'doctor' then 0 when 'duty_doctor' then 1 else 2 end,
    p.full_name nulls last;
$$;

grant execute on function public.list_clinic_doctors(uuid) to authenticated;

drop policy if exists patients_select on public.patients;
create policy patients_select on public.patients
for select using (
  deleted_at is null
  and (
    public.is_super_admin()
    or public.is_org_admin(organization_id)
    or (
      public.can_use_clinic(workspace_id)
      and (
        exists (
          select 1 from public.workspace_role_keys(patients.workspace_id) k
          where k.k = any (array['receptionist', 'admin'])
        )
        or exists (
          select 1 from public.appointments a
          where a.patient_id = patients.id and a.doctor_id = auth.uid()
        )
        or exists (
          select 1 from public.consultations c
          where c.patient_id = patients.id and c.doctor_id = auth.uid()
        )
        or exists (
          select 1 from public.patient_procedures pp
          where pp.patient_id = patients.id and pp.doctor_id = auth.uid()
        )
      )
    )
  )
);
