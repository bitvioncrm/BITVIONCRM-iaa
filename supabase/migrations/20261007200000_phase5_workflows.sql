-- Workflow functions. Does not edit earlier migrations.

create or replace function public.merge_leads(keeper uuid, duplicate uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if keeper = duplicate then
    raise exception 'Choose two different leads';
  end if;
  update public.lead_notes set lead_id = keeper where lead_id = duplicate;
  update public.followups set lead_id = keeper where lead_id = duplicate;
  update public.lead_assignments set lead_id = keeper where lead_id = duplicate;
  update public.lead_status_history set lead_id = keeper where lead_id = duplicate;
  update public.messages set lead_id = keeper where lead_id = duplicate;
  update public.patients set lead_id = keeper where lead_id = duplicate;
  update public.students set lead_id = keeper where lead_id = duplicate;
  update public.leads
  set deleted_at = now(), deleted_by = actor, updated_by = actor, updated_at = now()
  where id = duplicate and deleted_at is null;
  insert into public.audit_logs (user_id, action, entity, entity_id, metadata)
  values (actor, 'lead_merged', 'leads', keeper, jsonb_build_object('duplicate', duplicate));
end;
$$;

create or replace function public.next_bde(ws uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select ur.user_id
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.workspace_id = ws
    and r.key in ('clinic_bde', 'institute_bde')
  order by (
    select count(*) from public.leads l
    where l.assigned_to = ur.user_id and l.workspace_id = ws and l.deleted_at is null
  ), ur.user_id
  limit 1;
$$;

revoke all on function public.next_bde(uuid) from public, anon, authenticated;
grant execute on function public.next_bde(uuid) to service_role;
