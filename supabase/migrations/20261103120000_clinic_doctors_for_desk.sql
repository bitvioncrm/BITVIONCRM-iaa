create or replace function public.list_clinic_doctors(ws uuid)
returns table (user_id uuid, full_name text, role_key text)
language sql
stable
security definer
set search_path = public
as $$
  select
    ur.user_id,
    coalesce(nullif(trim(p.full_name), ''), case when r.key = 'duty_doctor' then 'Duty Doctor' else 'Doctor' end) as full_name,
    r.key as role_key
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  left join public.profiles p on p.id = ur.user_id
  where ur.workspace_id = ws
    and r.key in ('doctor', 'duty_doctor')
    and (
      public.is_super_admin()
      or ws in (select public.member_workspace_ids())
      or exists (
        select 1
        from public.workspaces w
        where w.id = ws
          and public.is_org_admin(w.organization_id)
      )
    )
  order by case r.key when 'doctor' then 0 else 1 end, p.full_name nulls last;
$$;

grant execute on function public.list_clinic_doctors(uuid) to authenticated;

drop policy if exists user_roles_workspace_read on public.user_roles;
create policy user_roles_workspace_read on public.user_roles
  for select to authenticated
  using (
    workspace_id is not null
    and workspace_id in (select public.member_workspace_ids())
  );

drop policy if exists profiles_workspace_read on public.profiles;
create policy profiles_workspace_read on public.profiles
  for select to authenticated
  using (
    exists (
      select 1
      from public.user_roles mine
      join public.user_roles theirs
        on theirs.workspace_id = mine.workspace_id
       and theirs.user_id = profiles.id
      where mine.user_id = auth.uid()
        and mine.workspace_id is not null
    )
  );
