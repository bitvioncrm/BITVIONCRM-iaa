-- Always expose Rimisha, Siji, and Bhama by name for reception assignment.
update public.profiles set full_name = 'Doctor Rimisha', updated_at = now() where lower(email) like 'doctor@%';
update public.profiles set full_name = 'Doctor Siji', updated_at = now() where lower(email) like 'siji@%' or lower(email) like 'duty@%';
update public.profiles set full_name = 'Doctor Bhama', updated_at = now() where lower(email) like 'bhama@%';

drop function if exists public.list_clinic_doctors(uuid);

create or replace function public.list_clinic_doctors(ws uuid)
returns table (user_id uuid, full_name text, role_key text, email text)
language sql
stable
security definer
set search_path = public
as $$
  select
    ur.user_id,
    case
      when lower(coalesce(p.email, '')) like 'bhama@%' or lower(coalesce(p.full_name, '')) like '%bhama%' or r.key = 'doctor_bhama'
        then 'Doctor Bhama'
      when lower(coalesce(p.email, '')) like 'siji@%' or lower(coalesce(p.email, '')) like 'duty@%' or lower(coalesce(p.full_name, '')) like '%siji%' or r.key = 'duty_doctor'
        then 'Doctor Siji'
      when lower(coalesce(p.email, '')) like 'doctor@%' or lower(coalesce(p.full_name, '')) like '%rimisha%'
        then 'Doctor Rimisha'
      else coalesce(nullif(trim(p.full_name), ''), 'Doctor Rimisha')
    end as full_name,
    r.key as role_key,
    coalesce(p.email, '') as email
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
    case
      when lower(coalesce(p.email, '')) like 'doctor@%' or lower(coalesce(p.full_name, '')) like '%rimisha%' then 0
      when r.key = 'duty_doctor' or lower(coalesce(p.email, '')) like 'siji@%' then 1
      else 2
    end,
    p.full_name nulls last;
$$;

grant execute on function public.list_clinic_doctors(uuid) to authenticated;
