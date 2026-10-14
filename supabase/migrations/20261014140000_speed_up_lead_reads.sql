-- The lead list called can_read_lead once per row. With about 12,000 leads that
-- exceeded the API statement timeout. Membership checks now run once per query.

create index if not exists leads_open_created_idx
  on public.leads (created_at desc)
  where deleted_at is null;

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
    )
  );
