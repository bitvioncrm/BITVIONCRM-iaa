-- Give Doctor Bhama the same clinic doctor role access as Rimisha,
-- and copy doctor permissions onto duty_doctor / doctor_bhama.

do $$
declare
  bhama_id uuid;
  clinic_ws uuid;
  org_id uuid;
  doctor_role uuid;
  bhama_role uuid;
begin
  select id into bhama_id from auth.users where lower(email) = 'bhama@drks.com';
  select id, organization_id into clinic_ws, org_id
  from public.workspaces
  where workspace_type = 'clinic' and deleted_at is null
  order by created_at
  limit 1;
  select id into doctor_role from public.roles where key = 'doctor';
  select id into bhama_role from public.roles where key = 'doctor_bhama';

  if bhama_id is null or clinic_ws is null or doctor_role is null then
    raise exception 'Doctor Bhama or clinic doctor role missing';
  end if;

  update public.profiles
  set full_name = 'Doctor Bhama',
      organization_id = coalesce(organization_id, org_id),
      email = 'bhama@drks.com',
      updated_at = now()
  where id = bhama_id;

  if bhama_role is not null then
    delete from public.user_roles
    where user_id = bhama_id
      and role_id = bhama_role;
  end if;

  insert into public.user_roles (user_id, role_id, workspace_id, organization_id)
  select bhama_id, doctor_role, clinic_ws, org_id
  where not exists (
    select 1 from public.user_roles ur
    where ur.user_id = bhama_id
      and ur.role_id = doctor_role
      and ur.workspace_id = clinic_ws
  );

  update public.profiles
  set organization_id = coalesce(organization_id, org_id),
      full_name = 'Doctor Siji',
      updated_at = now()
  where email in ('siji@drks.com', 'duty@drks.com');
end $$;

insert into public.role_permissions (role_id, permission_id)
select target.id, rp.permission_id
from public.roles source
join public.role_permissions rp on rp.role_id = source.id
join public.roles target on target.key in ('duty_doctor', 'doctor_bhama')
where source.key = 'doctor'
on conflict do nothing;

create or replace function public.is_clinic_doctor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()
      and r.key in ('doctor', 'duty_doctor', 'doctor_bhama')
  );
$$;

grant execute on function public.is_clinic_doctor() to authenticated;
