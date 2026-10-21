-- Clinic leads stay on the clinic desk and go only to a clinic telecaller.
-- Institute leads stay on the institute desk and go only to an institute telecaller.

create or replace function public.lead_assignment_totals()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'unassigned', (
      select count(*)::integer
      from public.leads
      where deleted_at is null
        and assigned_to is null
    ),
    'desks', coalesce((
      select jsonb_object_agg(workspace_id, unassigned)
      from (
        select workspace_id, count(*)::integer as unassigned
        from public.leads
        where deleted_at is null
          and assigned_to is null
        group by workspace_id
      ) desk_totals
    ), '{}'::jsonb),
    'assigned', coalesce((
      select jsonb_object_agg(assigned_to, lead_count)
      from (
        select assigned_to, count(*)::integer as lead_count
        from public.leads
        where deleted_at is null
          and assigned_to is not null
        group by assigned_to
      ) totals
    ), '{}'::jsonb)
  );
$$;

create or replace function public.assign_lead_count(p_assignee_id uuid, p_limit integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  target_id uuid;
  org uuid;
  desk text;
  assigned_count integer := 0;
begin
  if actor is null then
    raise exception 'Not signed in';
  end if;
  if p_limit is null or p_limit < 1 then
    raise exception 'Enter how many leads to assign';
  end if;
  if p_limit > 100000 then
    raise exception 'Assign at most 100000 leads at a time';
  end if;

  select w.id, w.organization_id, w.workspace_type
    into target_id, org, desk
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
    raise exception 'Only an admin can assign these leads';
  end if;

  with picked as (
    select l.id
    from public.leads l
    where l.deleted_at is null
      and l.assigned_to is null
      and l.workspace_id = target_id
    order by (l.source = 'meta_ads') desc, l.created_at desc
    limit p_limit
    for update
  ),
  updated as (
    update public.leads
    set assigned_to = p_assignee_id,
        assigned_at = now(),
        updated_by = actor,
        updated_at = now()
    where id in (select picked.id from picked)
    returning id, organization_id, workspace_id
  ),
  logged as (
    insert into public.lead_assignments (organization_id, workspace_id, lead_id, assigned_to, assigned_by)
    select organization_id, workspace_id, id, p_assignee_id, actor
    from updated
    returning 1
  )
  select count(*)::integer into assigned_count from logged;

  insert into public.audit_logs (organization_id, workspace_id, user_id, action, entity, metadata)
  values (
    org,
    target_id,
    actor,
    'leads_assigned',
    'leads',
    jsonb_build_object('count', assigned_count, 'requested', p_limit, 'assigned_to', p_assignee_id, 'desk', desk)
  );

  return assigned_count;
end;
$$;
