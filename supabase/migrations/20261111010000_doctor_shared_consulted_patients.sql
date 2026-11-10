-- Clinic doctors can read every previously consulted / completed patient card,
-- while still keeping today+ assignment workflows on appointment.doctor_id.

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
          where k.k = any (array['receptionist', 'admin'])
        )
        or exists (
          select 1 from public.appointments a
          where a.patient_id = patients.id and a.doctor_id = auth.uid()
        )
        or exists (
          select 1 from public.consultations c
          where c.patient_id = patients.id and c.doctor_id = auth.uid()
        )
        or exists (
          select 1 from public.patient_procedures pp
          where pp.patient_id = patients.id and pp.doctor_id = auth.uid()
        )
        or (
          public.is_clinic_doctor()
          and (
            exists (
              select 1 from public.appointments a
              where a.patient_id = patients.id
                and a.workspace_id = patients.workspace_id
                and a.status = 'completed'
            )
            or exists (
              select 1 from public.consultations c
              where c.patient_id = patients.id
                and c.workspace_id = patients.workspace_id
            )
            or exists (
              select 1 from public.patient_procedures pp
              where pp.patient_id = patients.id
                and pp.workspace_id = patients.workspace_id
            )
          )
        )
      )
    )
  )
);
