-- Follow-up migration. Does not edit earlier files.
-- Tightens doctor and institute-user reads, blocks negative stock,
-- keeps the audit log append-only, and adds a revenue aggregate.

drop policy if exists patients_rw on public.patients;

create policy patients_select on public.patients
  for select to authenticated
  using (
    deleted_at is null
    and (
      public.is_super_admin()
      or public.is_org_admin(organization_id)
      or (
        public.can_use_clinic(workspace_id)
        and (
          exists (select 1 from public.workspace_role_keys(workspace_id) k where k in ('receptionist', 'admin'))
          or exists (select 1 from public.appointments a where a.patient_id = patients.id and a.doctor_id = auth.uid())
          or exists (select 1 from public.consultations c where c.patient_id = patients.id and c.doctor_id = auth.uid())
        )
      )
    )
  );

create policy patients_write on public.patients
  for insert to authenticated
  with check (
    public.is_super_admin()
    or public.is_org_admin(organization_id)
    or exists (select 1 from public.workspace_role_keys(workspace_id) k where k in ('receptionist', 'admin'))
  );

create policy patients_update on public.patients
  for update to authenticated
  using (
    public.is_super_admin()
    or public.is_org_admin(organization_id)
    or exists (select 1 from public.workspace_role_keys(workspace_id) k where k in ('receptionist', 'admin'))
    or exists (select 1 from public.appointments a where a.patient_id = patients.id and a.doctor_id = auth.uid())
  )
  with check (public.can_use_clinic(workspace_id));

drop policy if exists students_rw on public.students;

create policy students_select on public.students
  for select to authenticated
  using (
    deleted_at is null
    and public.can_use_institute(workspace_id)
    and (
      public.is_super_admin()
      or public.is_org_admin(organization_id)
      or exists (select 1 from public.workspace_role_keys(workspace_id) k where k in ('admin', 'institute_bde'))
      or counsellor_id = auth.uid()
    )
  );

create policy students_insert on public.students
  for insert to authenticated
  with check (
    public.can_use_institute(workspace_id)
    and (
      public.is_super_admin()
      or public.is_org_admin(organization_id)
      or counsellor_id = auth.uid()
    )
  );

create policy students_update on public.students
  for update to authenticated
  using (
    public.is_super_admin()
    or public.is_org_admin(organization_id)
    or counsellor_id = auth.uid()
    or exists (select 1 from public.workspace_role_keys(workspace_id) k where k in ('admin', 'institute_bde'))
  )
  with check (public.can_use_institute(workspace_id));

revoke update, delete on public.audit_logs from anon, authenticated;

create or replace function public.apply_stock_change(product uuid, kind text, qty numeric)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  org uuid;
  ws uuid;
  stock numeric;
begin
  select organization_id, workspace_id, current_stock into org, ws, stock
  from public.inventory_products where id = product;
  if org is null then
    raise exception 'Product not found';
  end if;
  if stock + qty < 0 then
    raise exception 'Stock cannot go below zero';
  end if;
  insert into public.inventory_transactions (organization_id, workspace_id, product_id, transaction_type, quantity, created_by)
  values (org, ws, product, kind, qty, auth.uid());
  update public.inventory_products
  set current_stock = current_stock + qty
  where id = product;
end;
$$;

create or replace function public.revenue_totals(ws uuid, from_date date, to_date date)
returns table (gross numeric, discounts numeric, collected numeric, refunded numeric, net numeric, pending numeric)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if not public.can_view_money(ws) then
    raise exception 'Not allowed';
  end if;
  return query
  with inv as (
    select coalesce(sum(total + discount), 0) as gross_amount,
           coalesce(sum(discount), 0) as discount_amount,
           coalesce(sum(total), 0) as billed
    from public.invoices
    where workspace_id = ws and issued_on between from_date and to_date
  ),
  pay as (
    select coalesce(sum(amount), 0) as collected_amount
    from public.payments
    where workspace_id = ws and paid_on between from_date and to_date
  ),
  ref as (
    select coalesce(sum(amount), 0) as refunded_amount
    from public.refunds
    where workspace_id = ws and created_at::date between from_date and to_date
  )
  select inv.gross_amount, inv.discount_amount, pay.collected_amount, ref.refunded_amount,
         pay.collected_amount - ref.refunded_amount,
         greatest(inv.billed - pay.collected_amount, 0)
  from inv, pay, ref;
end;
$$;

create unique index if not exists automation_runs_once_idx
  on public.automation_runs (rule_id, entity_type, entity_id);

drop policy if exists documents_object_read on storage.objects;
drop policy if exists documents_object_insert on storage.objects;
create policy documents_object_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and split_part(name, '/', 2)::uuid in (select public.member_workspace_ids())
  );
create policy documents_object_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and split_part(name, '/', 2)::uuid in (select public.member_workspace_ids())
  );
