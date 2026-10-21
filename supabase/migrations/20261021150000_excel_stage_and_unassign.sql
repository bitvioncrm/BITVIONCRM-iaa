-- Excel sheet rows use the Excel stage so the stage filter can separate them from live New leads.
-- An admin can return a telecaller's assigned leads to the waiting list on that same desk.

alter table public.leads drop constraint if exists leads_status_check;

alter table public.leads add constraint leads_status_check check (
  status in (
    'excel', 'new', 'contacted', 'interested', 'follow_up', 'documents_pending',
    'processing', 'interview', 'selected', 'converted', 'lost'
  )
);

update public.leads
set source_platform = 'excel'
where deleted_at is null
  and source = 'whatsapp'
  and coalesce(source_platform, '') = '';

update public.leads
set status = 'excel',
    updated_at = now()
where deleted_at is null
  and status = 'new'
  and (
    source_platform = 'excel'
    or (source = 'whatsapp' and coalesce(source_platform, '') = '')
  );

create or replace function public.clear_assigned_leads(p_assignee_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  target_id uuid;
  org uuid;
  cleared integer := 0;
begin
  if actor is null then
    raise exception 'Not signed in';
  end if;

  select w.id, w.organization_id
    into target_id, org
  from public.user_roles ur
  join public.workspaces w on w.id = ur.workspace_id
  join public.roles r on r.id = ur.role_id
  where ur.user_id = p_assignee_id
    and w.deleted_at is null
    and r.key = any (
      case w.workspace_type
        when 'clinic' then array['clinic_telecaller', 'clinic_bde']
        when 'institute' then array['institute_telecaller', 'institute_bde', 'institute_user']
        else array[]::text[]
      end
    )
  limit 1;

  if target_id is null then
    raise exception 'Choose a clinic or institute telecaller';
  end if;

  if not (
    public.is_super_admin()
    or public.is_org_admin(org)
  ) then
    raise exception 'Only an admin can remove these assignments';
  end if;

  with updated as (
    update public.leads
    set assigned_to = null,
        assigned_at = null,
        updated_by = actor,
        updated_at = now()
    where deleted_at is null
      and workspace_id = target_id
      and assigned_to = p_assignee_id
    returning id, organization_id, workspace_id
  ),
  logged as (
    insert into public.lead_assignments (organization_id, workspace_id, lead_id, assigned_to, assigned_by)
    select organization_id, workspace_id, id, null, actor
    from updated
    returning 1
  )
  select count(*)::integer into cleared from logged;

  insert into public.audit_logs (organization_id, workspace_id, user_id, action, entity, metadata)
  values (
    org,
    target_id,
    actor,
    'leads_unassigned',
    'leads',
    jsonb_build_object('count', cleared, 'assigned_to', p_assignee_id)
  );

  return cleared;
end;
$$;

revoke all on function public.clear_assigned_leads(uuid) from public, anon;
grant execute on function public.clear_assigned_leads(uuid) to authenticated;
