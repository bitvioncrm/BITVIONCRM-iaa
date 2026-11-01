drop policy if exists clinic_ledger_institute on public.clinic_ledger;
create policy clinic_ledger_institute on public.clinic_ledger
  for all to authenticated
  using (
    public.can_use_institute(workspace_id)
    and exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.workspace_type = 'institute' and w.deleted_at is null
    )
  )
  with check (
    public.can_use_institute(workspace_id)
    and exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.workspace_type = 'institute' and w.deleted_at is null
    )
  );

drop policy if exists refunds_institute on public.refunds;
create policy refunds_institute on public.refunds
  for all to authenticated
  using (
    public.can_use_institute(workspace_id)
    and exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.workspace_type = 'institute' and w.deleted_at is null
    )
  )
  with check (
    public.can_use_institute(workspace_id)
    and exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.workspace_type = 'institute' and w.deleted_at is null
    )
  );
