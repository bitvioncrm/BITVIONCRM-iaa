-- Admin can hand every unassigned lead on one desk to that desk's telecaller
-- in one step. Clinic leads stay on the clinic desk.

drop function if exists public.assign_unassigned_leads(uuid, uuid);

create function public.assign_unassigned_leads(p_workspace_id uuid, p_assignee_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  desk text;
  org uuid;
  assigned_count integer := 0;
begin
  if actor is null then
    raise exception 'Not signed in';
  end if;

  select w.workspace_type, w.organization_id
    into desk, org
  from public.workspaces w
  where w.id = p_workspace_id
    and w.deleted_at is null;

  if desk is null then
    raise exception 'Desk not found';
  end if;

  if not (
    public.is_super_admin()
    or public.is_org_admin(org)
  ) then
    raise exception 'Only an admin can assign these leads';
  end if;

  if not exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = p_assignee_id
      and ur.workspace_id = p_workspace_id
      and r.key = any (
        case desk
          when 'clinic' then array['clinic_telecaller', 'clinic_bde']
          when 'institute' then array['institute_telecaller', 'institute_bde', 'institute_user']
          else array[]::text[]
        end
      )
  ) then
    raise exception 'Choose a telecaller on this desk';
  end if;

  with updated as (
    update public.leads
    set assigned_to = p_assignee_id,
        assigned_at = now(),
        updated_by = actor,
        updated_at = now()
    where leads.workspace_id = p_workspace_id
      and deleted_at is null
      and assigned_to is null
    returning id, organization_id, leads.workspace_id
  ),
  logged as (
    insert into public.lead_assignments (organization_id, workspace_id, lead_id, assigned_to, assigned_by)
    select organization_id, updated.workspace_id, id, p_assignee_id, actor
    from updated
    returning 1
  )
  select count(*)::integer into assigned_count from logged;

  insert into public.audit_logs (organization_id, workspace_id, user_id, action, entity, metadata)
  values (org, p_workspace_id, actor, 'leads_assigned', 'leads', jsonb_build_object('count', assigned_count, 'assigned_to', p_assignee_id));

  return assigned_count;
end;
$$;

revoke all on function public.assign_unassigned_leads(uuid, uuid) from public, anon;
grant execute on function public.assign_unassigned_leads(uuid, uuid) to authenticated;
