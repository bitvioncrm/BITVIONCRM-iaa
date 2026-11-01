drop policy if exists appointments_callers on public.appointments;
create policy appointments_callers on public.appointments
  for all to authenticated
  using (
    exists (
      select 1 from public.workspace_role_keys(workspace_id) k
      where k in ('clinic_telecaller', 'clinic_bde')
    )
  )
  with check (
    exists (
      select 1 from public.workspace_role_keys(workspace_id) k
      where k in ('clinic_telecaller', 'clinic_bde')
    )
  );

drop policy if exists patients_callers_read on public.patients;
create policy patients_callers_read on public.patients
  for select to authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from public.workspace_role_keys(workspace_id) k
      where k in ('clinic_telecaller', 'clinic_bde')
    )
  );

drop policy if exists patients_callers_insert on public.patients;
create policy patients_callers_insert on public.patients
  for insert to authenticated
  with check (
    exists (
      select 1 from public.workspace_role_keys(workspace_id) k
      where k in ('clinic_telecaller', 'clinic_bde')
    )
  );

drop policy if exists patients_callers_update on public.patients;
create policy patients_callers_update on public.patients
  for update to authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from public.workspace_role_keys(workspace_id) k
      where k in ('clinic_telecaller', 'clinic_bde')
    )
  )
  with check (
    exists (
      select 1 from public.workspace_role_keys(workspace_id) k
      where k in ('clinic_telecaller', 'clinic_bde')
    )
  );
