alter table public.call_time_sessions
  add column if not exists lead_id uuid references public.leads (id),
  add column if not exists outcome text;

alter table public.call_time_sessions
  drop constraint if exists call_time_outcome_check;

alter table public.call_time_sessions
  add constraint call_time_outcome_check
  check (outcome is null or outcome in ('connected', 'rejected', 'no_answer'));

create index if not exists call_time_lead_idx on public.call_time_sessions (lead_id, started_at desc);
create index if not exists call_time_workspace_day_idx on public.call_time_sessions (workspace_id, started_at desc);

drop policy if exists call_time_own on public.call_time_sessions;
drop policy if exists call_time_select on public.call_time_sessions;
drop policy if exists call_time_insert on public.call_time_sessions;
drop policy if exists call_time_update on public.call_time_sessions;

create policy call_time_select on public.call_time_sessions
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.is_super_admin())
    or public.is_org_admin(organization_id)
  );

create policy call_time_insert on public.call_time_sessions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and workspace_id in (select public.member_workspace_ids())
    and (
      lead_id is null
      or exists (
        select 1
        from public.leads l
        where l.id = lead_id
          and l.workspace_id = workspace_id
          and l.deleted_at is null
      )
    )
  );

create policy call_time_update on public.call_time_sessions
  for update to authenticated
  using (user_id = (select auth.uid()) and status = 'active')
  with check (user_id = (select auth.uid()));
