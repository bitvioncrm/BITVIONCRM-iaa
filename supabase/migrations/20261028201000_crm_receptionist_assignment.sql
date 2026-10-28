-- CRM & Leads can assign and clear the same people the automatic rule uses:
-- clinic reception and clinic telecallers, institute telecallers.

create or replace function public.assign_incoming_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  desk text;
  slot integer;
  target uuid;
begin
  if new.assigned_to is not null then
    return new;
  end if;
  if new.status = 'excel'
    or coalesce(new.source_platform, '') = 'excel'
    or (new.source = 'whatsapp' and coalesce(new.source_platform, '') = '') then
    return new;
  end if;

  select workspace_type into desk from public.workspaces where id = new.workspace_id and deleted_at is null;
  if desk = 'institute' then
    select ur.user_id into target
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.workspace_id = new.workspace_id and r.key = 'institute_telecaller'
    order by ur.user_id
    limit 1;
  elsif desk = 'clinic' then
    select count(*) into slot
    from public.leads
    where workspace_id = new.workspace_id
      and assigned_to is not null
      and deleted_at is null
      and status <> 'excel'
      and coalesce(source_platform, '') <> 'excel'
      and not (source = 'whatsapp' and coalesce(source_platform, '') = '');
    if slot % 10 < 3 then
      select ur.user_id into target
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.workspace_id = new.workspace_id and r.key = 'receptionist'
      order by ur.user_id
      limit 1;
    else
      select ur.user_id into target
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.workspace_id = new.workspace_id and r.key = 'clinic_telecaller'
      order by ur.user_id
      limit 1;
    end if;
  end if;

  if target is not null then
    new.assigned_to := target;
    new.assigned_at := coalesce(new.assigned_at, now());
  end if;
  return new;
end;
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
        when 'clinic' then array['receptionist', 'clinic_telecaller', 'clinic_bde']
        when 'institute' then array['institute_telecaller', 'institute_bde', 'institute_user']
        else array[]::text[]
      end
    )
  limit 1;

  if target_id is null then
    raise exception 'Choose reception or a telecaller on this desk';
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

create or replace function public.assign_unassigned_leads(p_workspace_id uuid, p_assignee_id uuid)
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
          when 'clinic' then array['receptionist', 'clinic_telecaller', 'clinic_bde']
          when 'institute' then array['institute_telecaller', 'institute_bde', 'institute_user']
          else array[]::text[]
        end
      )
  ) then
    raise exception 'Choose reception or a telecaller on this desk';
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
        when 'clinic' then array['receptionist', 'clinic_telecaller', 'clinic_bde']
        when 'institute' then array['institute_telecaller', 'institute_bde', 'institute_user']
        else array[]::text[]
      end
    )
  limit 1;

  if target_id is null then
    raise exception 'Choose reception or a telecaller on this desk';
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
