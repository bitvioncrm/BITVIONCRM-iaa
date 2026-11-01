-- Let every desk role create, update, and delete the records on the screens they already use.

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
      or exists (
        select 1
        from public.user_roles ur
        join public.roles r on r.id = ur.role_id
        where ur.user_id = (select auth.uid())
          and ur.workspace_id = ws
          and r.key in (
            'receptionist',
            'clinic_telecaller',
            'clinic_bde',
            'institute_telecaller',
            'institute_bde',
            'institute_user'
          )
      )
    );
$$;

create or replace function public.can_write_lead(ws uuid, assigned uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_read_lead(ws, assigned);
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
      or exists (
        select 1
        from public.user_roles ur
        join public.roles r on r.id = ur.role_id
        where ur.user_id = (select auth.uid())
          and ur.workspace_id = leads.workspace_id
          and r.key in (
            'receptionist',
            'clinic_telecaller',
            'clinic_bde',
            'institute_telecaller',
            'institute_bde',
            'institute_user'
          )
      )
    )
  );

drop policy if exists patients_write on public.patients;
create policy patients_write on public.patients
  for insert to authenticated
  with check (
    public.is_super_admin()
    or public.is_org_admin(organization_id)
    or public.can_use_clinic(workspace_id)
  );

drop policy if exists patients_update on public.patients;
create policy patients_update on public.patients
  for update to authenticated
  using (
    public.is_super_admin()
    or public.is_org_admin(organization_id)
    or public.can_use_clinic(workspace_id)
  )
  with check (
    public.is_super_admin()
    or public.is_org_admin(organization_id)
    or public.can_use_clinic(workspace_id)
  );

drop policy if exists consultations_clinical on public.consultations;
create policy consultations_clinical on public.consultations
  for all to authenticated
  using (public.can_use_clinic(workspace_id))
  with check (public.can_use_clinic(workspace_id));

drop policy if exists prescriptions_clinical on public.prescriptions;
create policy prescriptions_clinical on public.prescriptions
  for all to authenticated
  using (public.can_use_clinic(workspace_id))
  with check (public.can_use_clinic(workspace_id));

drop policy if exists students_select on public.students;
drop policy if exists students_insert on public.students;
drop policy if exists students_update on public.students;

create policy students_select on public.students
  for select to authenticated
  using (
    deleted_at is null
    and public.can_use_institute(workspace_id)
  );

create policy students_insert on public.students
  for insert to authenticated
  with check (public.can_use_institute(workspace_id));

create policy students_update on public.students
  for update to authenticated
  using (public.can_use_institute(workspace_id))
  with check (public.can_use_institute(workspace_id));

drop policy if exists tasks_rw on public.tasks;
create policy tasks_rw on public.tasks
  for all to authenticated
  using (
    deleted_at is null
    and (
      assigned_to = auth.uid()
      or public.is_super_admin()
      or public.is_org_admin(organization_id)
      or workspace_id in (select public.member_workspace_ids())
    )
  )
  with check (
    assigned_to = auth.uid()
    or public.is_super_admin()
    or public.is_org_admin(organization_id)
    or workspace_id in (select public.member_workspace_ids())
  );
