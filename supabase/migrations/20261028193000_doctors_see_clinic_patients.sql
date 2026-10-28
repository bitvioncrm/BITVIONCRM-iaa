drop policy if exists patients_select on public.patients;
create policy patients_select on public.patients
for select using (
  deleted_at is null
  and (
    public.is_super_admin()
    or public.is_org_admin(organization_id)
    or (
      public.can_use_clinic(workspace_id)
      and (
        exists (
          select 1 from public.workspace_role_keys(patients.workspace_id) k
          where k.k = any (array['receptionist', 'admin', 'doctor', 'duty_doctor'])
        )
        or exists (
          select 1 from public.appointments a
          where a.patient_id = patients.id and a.doctor_id = auth.uid()
        )
        or exists (
          select 1 from public.consultations c
          where c.patient_id = patients.id and c.doctor_id = auth.uid()
        )
      )
    )
  )
);
