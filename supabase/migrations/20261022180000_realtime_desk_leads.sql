-- Desk callers need to see unassigned Meta / WhatsApp leads on their desk in
-- realtime. Replica identity full keeps UPDATE payloads complete for the CRM.

alter table public.leads replica identity full;

create or replace function public.can_read_lead(ws uuid, assigned uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    ws in (select public.member_workspace_ids())
    and (
      (select public.is_super_admin())
      or assigned = (select auth.uid())
      or ws in (
        select w.id
        from public.workspaces w
        where w.deleted_at is null
          and public.is_org_admin(w.organization_id)
      )
      or exists (
        select 1
        from public.user_roles ur
        join public.roles r on r.id = ur.role_id
        where ur.user_id = (select auth.uid())
          and ur.workspace_id = ws
          and r.key in (
            'clinic_telecaller',
            'clinic_bde',
            'institute_telecaller',
            'institute_bde',
            'institute_user'
          )
      )
    );
$$;

drop policy if exists leads_select on public.leads;

create policy leads_select on public.leads
  for select to authenticated
  using (
    deleted_at is null
    and workspace_id in (select public.member_workspace_ids())
    and (
      (select public.is_super_admin())
      or assigned_to = (select auth.uid())
      or workspace_id in (
        select w.id
        from public.workspaces w
        where w.deleted_at is null
          and public.is_org_admin(w.organization_id)
      )
      or exists (
        select 1
        from public.user_roles ur
        join public.roles r on r.id = ur.role_id
        where ur.user_id = (select auth.uid())
          and ur.workspace_id = leads.workspace_id
          and r.key in (
            'clinic_telecaller',
            'clinic_bde',
            'institute_telecaller',
            'institute_bde',
            'institute_user'
          )
      )
    )
  );
