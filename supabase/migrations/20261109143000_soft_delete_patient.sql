create or replace function public.soft_delete_patient(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ws uuid;
  org uuid;
begin
  select workspace_id, organization_id into ws, org
  from public.patients
  where id = p_id and deleted_at is null;
  if ws is null then
    raise exception 'Patient not found or already deleted';
  end if;
  if not (
    public.is_super_admin()
    or public.is_org_admin(org)
    or public.can_use_clinic(ws)
  ) then
    raise exception 'Not allowed to delete this patient';
  end if;
  update public.patients
  set deleted_at = now(), updated_at = now()
  where id = p_id and deleted_at is null;
end;
$$;

revoke all on function public.soft_delete_patient(uuid) from public;
grant execute on function public.soft_delete_patient(uuid) to authenticated;
